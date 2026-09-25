/**
 * The Projection on the phone: every Raw Document past its endpoint's cursor, folded in fetch order with the server's upsert rules, one
 * transaction per document; `rebuild` empties the derived tables and replays from raw id 0 (task 0036, ADR-0004, ADR-0018 amendment).
 */
import type { SQLiteBindValue, SQLiteDatabase } from 'expo-sqlite';
import {
  BAND_DETAILS_ENDPOINT,
  FEED_UPDATES_ENDPOINT,
  FOLLOWING_BANDS_ENDPOINT,
  RELEASE_PAGE_ENDPOINT,
  WISHLIST_ITEMS_ENDPOINT,
} from '../domain/endpoints';
import { FeedPayloadError, parseFeedUpdates } from '../domain/parse';
import { BandDetailsPayloadError, parseBandDetails } from '../domain/parseBandDetails';
import { FollowingBandsPayloadError, parseFollowingBands } from '../domain/parseFollowingBands';
import { parseReleasePage, ReleasePagePayloadError } from '../domain/parseReleasePage';
import { parseWishlistItems, WishlistItemsPayloadError } from '../domain/parseWishlistItems';
import type { ItemType, MutableSkippedCounts, ParsedFan, ParsedPage, ParsedRelease, ParsedStory, SkippedCounts } from '../domain/types';
import { BUSY_TIMEOUT_MS } from './schema';
import { listForProjection, type RawDocument } from './rawDocuments';

export const FOLD_BATCH_SIZE = 50;

/** `per-user` may open a shared row and fill empty detail; only `catalog` (band_details) overwrites name, url and band (ADR-0018). */
type Source = 'per-user' | 'catalog';

export type ProjectDocumentOutcome = 'projected' | 'skipped' | 'unparsable';

type Writes = {
  storiesUpserted: number;
  fansUpserted: number;
  pagesUpserted: number;
  releasesUpserted: number;
  releasesEnriched: number;
  followsUpserted: number;
  followsRemoved: number;
  wishlistItemsUpserted: number;
  wishlistItemsRemoved: number;
};

export type ProjectDocumentResult = Readonly<Writes> & {
  readonly outcome: ProjectDocumentOutcome;
  readonly skipped: SkippedCounts;
};

export type FoldSummary = Readonly<Writes> & {
  readonly documentsProcessed: number;
  readonly documentsSkipped: number;
  readonly documentsUnparsable: number;
  readonly skipped: SkippedCounts;
};

function noWrites(): Writes {
  return {
    storiesUpserted: 0,
    fansUpserted: 0,
    pagesUpserted: 0,
    releasesUpserted: 0,
    releasesEnriched: 0,
    followsUpserted: 0,
    followsRemoved: 0,
    wishlistItemsUpserted: 0,
    wishlistItemsRemoved: 0,
  };
}

const NO_SKIPS: SkippedCounts = { unknownStoryType: 0, unparsable: 0, missingFanInfo: 0 };

function result(outcome: ProjectDocumentOutcome, writes: Partial<Writes> = {}, skipped: SkippedCounts = NO_SKIPS): ProjectDocumentResult {
  return { ...noWrites(), ...writes, outcome, skipped };
}

function iso(date: Date | null): string | null {
  return date === null ? null : date.toISOString();
}

function flag(value: boolean | null): number | null {
  return value === null ? null : value ? 1 : 0;
}

const PAGE_INSERT = `insert into pages (band_id, name, url, image_id, genre_id, first_seen_at, last_seen_at)
  values (?, ?, ?, ?, ?, ?, ?)
  on conflict (band_id) do update set`;

const PAGE_CATALOG_SET = `name = excluded.name, url = coalesce(excluded.url, pages.url),`;

const PAGE_SHARED_SET = `
  image_id = coalesce(excluded.image_id, pages.image_id),
  genre_id = coalesce(excluded.genre_id, pages.genre_id),
  first_seen_at = min(pages.first_seen_at, excluded.first_seen_at),
  last_seen_at = max(pages.last_seen_at, excluded.last_seen_at)`;

async function upsertPage(db: SQLiteDatabase, page: ParsedPage, seenAt: string, source: Source): Promise<void> {
  const set = source === 'catalog' ? PAGE_CATALOG_SET + PAGE_SHARED_SET : PAGE_SHARED_SET;
  await db.runAsync(`${PAGE_INSERT} ${set}`, [page.bandId, page.name, page.url, page.imageId, page.genreId, seenAt, seenAt]);
}

const RELEASE_INSERT = `insert into releases (
    item_type, item_id, band_id, title, url, album_id, album_title, art_id, release_date, label, label_id, price,
    currency, featured_track_id, featured_track_title, featured_track_duration, num_streamable_tracks,
    also_collected_count, is_preorder, tags, first_seen_at, last_seen_at
  ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  on conflict (item_type, item_id) do update set`;

const RELEASE_CATALOG_SET = `title = excluded.title, url = excluded.url, band_id = excluded.band_id,`;

const RELEASE_SHARED_SET = `
  is_preorder = coalesce(?, releases.is_preorder),
  album_id = coalesce(excluded.album_id, releases.album_id),
  album_title = coalesce(excluded.album_title, releases.album_title),
  art_id = coalesce(excluded.art_id, releases.art_id),
  release_date = coalesce(excluded.release_date, releases.release_date),
  label = coalesce(excluded.label, releases.label),
  label_id = coalesce(excluded.label_id, releases.label_id),
  price = coalesce(excluded.price, releases.price),
  currency = coalesce(excluded.currency, releases.currency),
  featured_track_id = coalesce(excluded.featured_track_id, releases.featured_track_id),
  featured_track_title = coalesce(excluded.featured_track_title, releases.featured_track_title),
  featured_track_duration = coalesce(excluded.featured_track_duration, releases.featured_track_duration),
  num_streamable_tracks = coalesce(excluded.num_streamable_tracks, releases.num_streamable_tracks),
  also_collected_count = coalesce(excluded.also_collected_count, releases.also_collected_count),
  tags = case when excluded.tags = '[]' then releases.tags else excluded.tags end,
  first_seen_at = min(releases.first_seen_at, excluded.first_seen_at),
  last_seen_at = max(releases.last_seen_at, excluded.last_seen_at)`;

type ReleaseUpsert = Omit<ParsedRelease, 'isPreorder'> & { readonly isPreorder: boolean | null };

/** A source silent on `is_preorder` inserts the column default and never unlearns a stated `true` on update. */
async function upsertRelease(db: SQLiteDatabase, release: ReleaseUpsert, seenAt: string, source: Source): Promise<void> {
  const set = source === 'catalog' ? RELEASE_CATALOG_SET + RELEASE_SHARED_SET : RELEASE_SHARED_SET;
  const values: SQLiteBindValue[] = [
    release.itemType,
    release.itemId,
    release.bandId,
    release.title,
    release.url,
    release.albumId,
    release.albumTitle,
    release.artId,
    iso(release.releaseDate),
    release.label,
    release.labelId,
    release.price,
    release.currency,
    release.featuredTrackId,
    release.featuredTrackTitle,
    release.featuredTrackDuration,
    release.numStreamableTracks,
    release.alsoCollectedCount,
    flag(release.isPreorder) ?? 0,
    JSON.stringify(release.tags),
    seenAt,
    seenAt,
    flag(release.isPreorder),
  ];
  await db.runAsync(`${RELEASE_INSERT} ${set}`, values);
}

type Enrichment = {
  readonly itemType: ItemType;
  readonly itemId: number;
  readonly releaseDate: Date | null;
  readonly isPreorder: boolean | null;
  readonly numStreamableTracks: number | null;
};

/** An update, never an insert: a public page states a date, not a Release. Answers whether a held row took it. */
async function enrichReleaseFromPage(db: SQLiteDatabase, input: Enrichment, seenAt: string): Promise<boolean> {
  const outcome = await db.runAsync(
    `update releases set
       release_date = coalesce(?, release_date),
       num_streamable_tracks = coalesce(?, num_streamable_tracks),
       is_preorder = coalesce(?, is_preorder),
       last_seen_at = max(last_seen_at, ?)
     where item_type = ? and item_id = ?`,
    [iso(input.releaseDate), input.numStreamableTracks, flag(input.isPreorder), seenAt, input.itemType, input.itemId],
  );
  return outcome.changes > 0;
}

async function upsertFan(db: SQLiteDatabase, fan: ParsedFan, seenAt: string): Promise<void> {
  await db.runAsync(
    `insert into fans (fan_id, username, name, location, image_id, first_seen_at, last_seen_at)
     values (?, ?, ?, ?, ?, ?, ?)
     on conflict (fan_id) do update set
       username = excluded.username,
       name = coalesce(excluded.name, fans.name),
       location = coalesce(excluded.location, fans.location),
       image_id = coalesce(excluded.image_id, fans.image_id),
       first_seen_at = min(fans.first_seen_at, excluded.first_seen_at),
       last_seen_at = max(fans.last_seen_at, excluded.last_seen_at)`,
    [fan.fanId, fan.username, fan.name, fan.location, fan.imageId, seenAt, seenAt],
  );
}

/** `fan_key` is 0 for a new release, which SQLite's unique index would otherwise treat as distinct from itself. */
async function upsertStory(db: SQLiteDatabase, story: ParsedStory, rawDocumentId: number): Promise<void> {
  await db.runAsync(
    `insert into stories (story_type, fan_id, fan_key, item_type, item_id, story_date, raw_document_id, review_text)
     values (?, ?, ?, ?, ?, ?, ?, ?)
     on conflict (story_type, fan_key, item_type, item_id) do update set
       story_date = excluded.story_date,
       review_text = coalesce(excluded.review_text, stories.review_text)`,
    [
      story.storyType,
      story.fanId,
      story.fanId ?? 0,
      story.itemType,
      story.itemId,
      story.storyDate.toISOString(),
      rawDocumentId,
      story.reviewText,
    ],
  );
}

async function projectFeedUpdates(db: SQLiteDatabase, doc: RawDocument): Promise<ProjectDocumentResult> {
  let parsed: ReturnType<typeof parseFeedUpdates>;
  try {
    parsed = parseFeedUpdates(doc.payload);
  } catch (err) {
    if (err instanceof FeedPayloadError) return result('unparsable');
    throw err;
  }
  for (const page of parsed.pages) await upsertPage(db, page, doc.fetchedAt, 'per-user');
  for (const release of parsed.releases) await upsertRelease(db, release, doc.fetchedAt, 'per-user');
  for (const fan of parsed.fans) await upsertFan(db, fan, doc.fetchedAt);
  for (const story of parsed.stories) await upsertStory(db, story, doc.id);
  return result(
    'projected',
    {
      storiesUpserted: parsed.stories.length,
      fansUpserted: parsed.fans.length,
      pagesUpserted: parsed.pages.length,
      releasesUpserted: parsed.releases.length,
    },
    parsed.skipped,
  );
}

async function projectReleasePage(db: SQLiteDatabase, doc: RawDocument): Promise<ProjectDocumentResult> {
  let parsed: ReturnType<typeof parseReleasePage>;
  try {
    parsed = parseReleasePage(doc.payload);
  } catch (err) {
    if (err instanceof ReleasePagePayloadError) return result('unparsable');
    throw err;
  }
  const enriched = await enrichReleaseFromPage(db, parsed, doc.fetchedAt);
  return result('projected', { releasesEnriched: enriched ? 1 : 0 });
}

async function pageExists(db: SQLiteDatabase, bandId: number): Promise<boolean> {
  return (await db.getFirstAsync<{ band_id: number }>('select band_id from pages where band_id = ?', [bandId])) !== null;
}

/** An item with no link, or for a Page we hold no row for, can only fill in a Release already held (ADR-0017). */
async function projectBandDetails(db: SQLiteDatabase, doc: RawDocument): Promise<ProjectDocumentResult> {
  let parsed: ReturnType<typeof parseBandDetails>;
  try {
    parsed = parseBandDetails(doc.payload);
  } catch (err) {
    if (err instanceof BandDetailsPayloadError) return result('unparsable');
    throw err;
  }
  const seenAt = doc.fetchedAt;
  const knownBands = new Set<number>();
  const missingBands = new Set<number>();
  for (const page of parsed.pages) {
    await upsertPage(db, page, seenAt, 'catalog');
    knownBands.add(page.bandId);
  }

  let upserted = 0;
  let enriched = 0;
  for (const release of parsed.releases) {
    if (!knownBands.has(release.bandId) && !missingBands.has(release.bandId)) {
      if (await pageExists(db, release.bandId)) knownBands.add(release.bandId);
      else missingBands.add(release.bandId);
    }
    if (release.url !== null && knownBands.has(release.bandId)) {
      await upsertRelease(
        db,
        {
          ...release,
          url: release.url,
          albumId: null,
          albumTitle: null,
          label: null,
          labelId: null,
          price: null,
          currency: null,
          featuredTrackId: null,
          featuredTrackTitle: null,
          featuredTrackDuration: null,
          numStreamableTracks: null,
          alsoCollectedCount: null,
          tags: [],
        },
        seenAt,
        'catalog',
      );
      upserted += 1;
      continue;
    }
    const filled = await enrichReleaseFromPage(db, { ...release, numStreamableTracks: null }, seenAt);
    if (filled) enriched += 1;
  }
  return result(
    'projected',
    { pagesUpserted: parsed.pages.length, releasesUpserted: upserted, releasesEnriched: enriched },
    parsed.skipped,
  );
}

/** Only a terminal page of a walk that carried its start may sweep the follows it no longer lists. */
async function projectFollowingBands(db: SQLiteDatabase, doc: RawDocument): Promise<ProjectDocumentResult> {
  let parsed: ReturnType<typeof parseFollowingBands>;
  try {
    parsed = parseFollowingBands(doc.payload);
  } catch (err) {
    if (err instanceof FollowingBandsPayloadError) return result('unparsable');
    throw err;
  }
  const seenAt = iso(parsed.snapshotStartedAt) ?? doc.fetchedAt;
  for (const bandId of parsed.bandIds) {
    await db.runAsync(
      `insert into follows (band_id, first_seen_at, last_seen_at) values (?, ?, ?)
       on conflict (band_id) do update set
         first_seen_at = min(follows.first_seen_at, excluded.first_seen_at),
         last_seen_at = max(follows.last_seen_at, excluded.last_seen_at)`,
      [bandId, seenAt, seenAt],
    );
  }
  let removed = 0;
  if (parsed.terminal && parsed.snapshotStartedAt !== null) {
    const swept = await db.runAsync('delete from follows where last_seen_at < ?', [parsed.snapshotStartedAt.toISOString()]);
    removed = swept.changes;
  }
  return result('projected', { followsUpserted: parsed.bandIds.length, followsRemoved: removed }, parsed.skipped);
}

/** Items are stamped with the walk's start, and only a terminal page removes what the snapshot stopped seeing. */
async function projectWishlistItems(db: SQLiteDatabase, doc: RawDocument): Promise<ProjectDocumentResult> {
  let parsed: ReturnType<typeof parseWishlistItems>;
  try {
    parsed = parseWishlistItems(doc.payload);
  } catch (err) {
    if (err instanceof WishlistItemsPayloadError) return result('unparsable');
    throw err;
  }
  const snapshot = parsed.snapshotStartedAt.toISOString();
  for (const item of parsed.items) {
    await db.runAsync(
      `insert into wishlist_items (item_type, item_id, band_id, added_at, last_seen_snapshot_at) values (?, ?, ?, ?, ?)
       on conflict (item_type, item_id) do update set
         band_id = coalesce(excluded.band_id, wishlist_items.band_id),
         added_at = coalesce(excluded.added_at, wishlist_items.added_at),
         last_seen_snapshot_at = max(excluded.last_seen_snapshot_at, wishlist_items.last_seen_snapshot_at)`,
      [item.itemType, item.itemId, item.bandId, iso(item.addedAt), snapshot],
    );
  }
  let removed = 0;
  if (parsed.terminal) {
    removed = (await db.runAsync('delete from wishlist_items where last_seen_snapshot_at < ?', [snapshot])).changes;
  }
  return result('projected', { wishlistItemsUpserted: parsed.items.length, wishlistItemsRemoved: removed }, parsed.skipped);
}

/** `fan_feed_page` HTML and anything unknown is skipped and kept on the raw side for a later parser. */
export async function projectRawDocument(db: SQLiteDatabase, doc: RawDocument): Promise<ProjectDocumentResult> {
  switch (doc.endpoint) {
    case FEED_UPDATES_ENDPOINT:
      return projectFeedUpdates(db, doc);
    case RELEASE_PAGE_ENDPOINT:
      return projectReleasePage(db, doc);
    case BAND_DETAILS_ENDPOINT:
      return projectBandDetails(db, doc);
    case FOLLOWING_BANDS_ENDPOINT:
      return projectFollowingBands(db, doc);
    case WISHLIST_ITEMS_ENDPOINT:
      return projectWishlistItems(db, doc);
    default:
      return result('skipped');
  }
}

type Tally = Writes & {
  documentsProcessed: number;
  documentsSkipped: number;
  documentsUnparsable: number;
  skipped: MutableSkippedCounts;
};

function emptyTally(): Tally {
  return {
    ...noWrites(),
    documentsProcessed: 0,
    documentsSkipped: 0,
    documentsUnparsable: 0,
    skipped: { unknownStoryType: 0, unparsable: 0, missingFanInfo: 0 },
  };
}

function tallyDocument(tally: Tally, outcome: ProjectDocumentResult): void {
  if (outcome.outcome === 'projected') tally.documentsProcessed += 1;
  if (outcome.outcome === 'skipped') tally.documentsSkipped += 1;
  if (outcome.outcome === 'unparsable') tally.documentsUnparsable += 1;
  for (const key of Object.keys(noWrites()) as (keyof Writes)[]) tally[key] += outcome[key];
  tally.skipped.unknownStoryType += outcome.skipped.unknownStoryType;
  tally.skipped.unparsable += outcome.skipped.unparsable;
  tally.skipped.missingFanInfo += outcome.skipped.missingFanInfo;
}

/**
 * A separate connection per document keeps the Fetcher's inserts on the main
 * connection out of a fold that rolls back; the cursor only moves forward, so two folds overlapping replay idempotently.
 */
async function foldDocument(db: SQLiteDatabase, doc: RawDocument): Promise<ProjectDocumentResult> {
  let outcome: ProjectDocumentResult = result('skipped');
  await db.withExclusiveTransactionAsync(async (txn) => {
    await txn.execAsync(`pragma busy_timeout = ${BUSY_TIMEOUT_MS}`);
    outcome = await projectRawDocument(txn, doc);
    await txn.runAsync(
      `insert into projection_progress (endpoint, last_raw_id) values (?, ?)
       on conflict (endpoint) do update set last_raw_id = max(projection_progress.last_raw_id, excluded.last_raw_id)`,
      [doc.endpoint, doc.id],
    );
  });
  return outcome;
}

export async function fold(db: SQLiteDatabase): Promise<FoldSummary> {
  const tally = emptyTally();
  for (;;) {
    const batch = await listForProjection(db, FOLD_BATCH_SIZE);
    if (batch.length === 0) break;
    for (const doc of batch) tallyDocument(tally, await foldDocument(db, doc));
  }
  return { ...tally, skipped: { ...tally.skipped } };
}

/** `band_sweeps` and `kv` are the Fetcher's own state, which no Raw Document could bring back, so they stay. */
export async function rebuild(db: SQLiteDatabase): Promise<FoldSummary> {
  await db.withExclusiveTransactionAsync(async (txn) => {
    await txn.execAsync(`
      pragma busy_timeout = ${BUSY_TIMEOUT_MS};
      delete from stories;
      delete from releases;
      delete from pages;
      delete from fans;
      delete from wishlist_items;
      delete from follows;
      delete from projection_progress;
    `);
  });
  return fold(db);
}

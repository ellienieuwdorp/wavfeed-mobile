/**
 * The Projection on the phone: every Raw Document past its endpoint's cursor, folded in fetch order with the server's
 * upsert rules (ADR-0004, ADR-0018 amendment). Documents fold in stretches, one transaction each, that end
 * after about `FOLD_STRETCH_MS` so the write lock never nears the busy timeout, each document behind a savepoint: one
 * whose fold throws is rolled back, recorded in `projection_failures`, reported, and passed (review findings PERF-2 and
 * ARCH-M1). `rebuild` empties the derived tables, marks the version it replays to in the same transaction, and replays
 * from raw id 0 in longer stretches on the main connection, so a replay cut short resumes from the cursors on the next
 * launch (ARCH-1, PERF-1). Feed entries and release pages that count the Tracks of an Upcoming Release also fold into
 * Drops (drops.ts).
 */
import type { SQLiteBindValue, SQLiteDatabase, SQLiteStatement } from 'expo-sqlite';
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
import type {
  ItemType,
  MutableSkippedCounts,
  ParsedFan,
  ParsedPage,
  ParsedRelease,
  ParsedReleasePage,
  ParsedStory,
  SkippedCounts,
} from '../domain/types';
import { aheadFrom } from '../domain/upcoming';
import { reportCode } from '../tally/errors';
import { foldFeedTrackRead, foldPageTrackRead, foldTrackPage } from './drops';
import { BUSY_TIMEOUT_MS, type FoldConnection, withFoldLock } from './foldLock';
import { countForProjection, listForProjection, type RawDocument } from './rawDocuments';
import { completeSnapshot, invalidateSnapshot } from './snapshots';

export const FOLD_BATCH_SIZE = 50;
/** A fold beside a running gather commits after about this long, far inside `BUSY_TIMEOUT_MS` (PERF-2). */
export const FOLD_STRETCH_MS = 250;
/** The launch replay, which nothing waits on but the screen, commits about once a second, the progress a kill loses. */
export const REPLAY_STRETCH_MS = 1000;

/**
 * Bumped with every parser fix; the store replays every Raw Document when it does not match (ADR-0004). Version 3 is how
 * a phone holding a pre-order dated by its feed entry mends itself after migration 5; version 4
 * writes the Drops its Raw Documents already hold after migration 6; version 5 counts the Tracks a
 * phone's page names without an id; version 6 lets the Track pages held open their Upcoming albums; version 7 validates whole membership snapshots before removals and replays catalog observations; version 8 fills the artist credit migration 11 adds.
 */
export const PROJECTION_VERSION = 8;
export const PROJECTION_VERSION_KEY = 'projectionVersion';
/** Set in the transaction that empties the derived tables, cleared in the one that writes the version (ARCH-1). */
export const PROJECTION_REBUILDING_KEY = 'projectionRebuildingTo';

/** How far a replay has come: documents folded and documents held. */
export type ReplayProgress = (done: number, total: number) => void;

async function readVersion(db: SQLiteDatabase, key: string): Promise<number | null> {
  const row = await db.getFirstAsync<{ value: string }>('select value from kv where key = ?', [key]);
  return row === null ? null : Number(JSON.parse(row.value));
}

/**
 * Launch drains pending observations on the main connection even when the version matches. An older
 * Projection rebuilds and an interrupted replay resumes; a newer one stays (ARCH-13). Answers whether it replayed.
 */
export async function ensureProjectionVersion(db: SQLiteDatabase, onProgress?: ReplayProgress): Promise<boolean> {
  const held = await readVersion(db, PROJECTION_VERSION_KEY);
  const rebuilding = await readVersion(db, PROJECTION_REBUILDING_KEY);
  if (rebuilding === PROJECTION_VERSION) {
    await replay(db, onProgress);
    return true;
  }
  if (rebuilding === null && held === PROJECTION_VERSION) {
    await foldStretches(db, { stretchMs: REPLAY_STRETCH_MS, connection: 'main', onProgress });
    return false;
  }
  if (rebuilding === null && held !== null && held > PROJECTION_VERSION) {
    reportCode('projection_newer', new Error(`projection version ${held} is newer than the code's ${PROJECTION_VERSION}`));
    return false;
  }
  await rebuild(db, onProgress);
  return true;
}

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
  readonly documentsFailed: number;
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

type Run = (sql: string, params: readonly SQLiteBindValue[]) => Promise<{ readonly changes: number }>;

/** A fold's transaction and its writes, each statement prepared once per transaction (PERF-2). */
type Folding = { readonly db: SQLiteDatabase; readonly run: Run };

/** Every write statement a transaction runs, prepared on first use and finalized as the transaction ends. */
function statementsFor(db: SQLiteDatabase): { readonly run: Run; readonly finalize: () => Promise<void> } {
  const held = new Map<string, Promise<SQLiteStatement>>();
  return {
    async run(sql, params) {
      let statement = held.get(sql);
      if (statement === undefined) {
        statement = db.prepareAsync(sql);
        held.set(sql, statement);
      }
      return (await statement).executeAsync([...params]);
    },
    async finalize() {
      for (const statement of held.values()) await statement.then((s) => s.finalizeAsync()).catch(() => undefined);
    },
  };
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

async function upsertPage(run: Run, page: ParsedPage, seenAt: string, source: Source): Promise<void> {
  const set = source === 'catalog' ? PAGE_CATALOG_SET + PAGE_SHARED_SET : PAGE_SHARED_SET;
  await run(`${PAGE_INSERT} ${set}`, [page.bandId, page.name, page.url, page.imageId, page.genreId, seenAt, seenAt]);
}

/**
 * Where a `release_date` came from: a feed entry, a release page, or the Sweep's discography.
 * `preorder` is a feed entry naming a pre-order, which states no release day and holds `release_date` empty.
 */
type ReleaseDateSource = 'feed' | 'preorder' | 'page' | 'sweep';

const RELEASE_DATE_COLUMNS = ['release_date', 'release_date_source', 'release_date_read_at'] as const;

/**
 * A page or the Sweep outranks the feed's pre-order, which outranks a feed date, so a Release the feed once named a
 * pre-order takes no date from a later entry rewritten as out. A row with no source ranks last.
 */
function dateRank(row: string): string {
  return `(case ${row}.release_date_source when 'page' then 3 when 'sweep' then 3 when 'preorder' then 2 when 'feed' then 1 else 0 end)`;
}

/** Rank, then the newer read, then the later date and the source name, so no two different rows compare equal. */
function dateOrder(row: string): string {
  return `(${dateRank(row)}, coalesce(${row}.release_date_read_at, ''), coalesce(${row}.release_date, ''), coalesce(${row}.release_date_source, ''))`;
}

/**
 * The incoming row takes the date columns only when it is strictly greater in `dateOrder`, a total order, so the held
 * date is the same whatever order the Raw Documents fold in (ADR-0011 amended). `incoming` and
 * `held` name the two rows; an incoming row with no source states nothing.
 */
function releaseDateSet(incoming: string, held: string): string {
  const takes = `(${incoming}.release_date_source is not null and ${dateOrder(incoming)} > ${dateOrder(held)})`;
  return RELEASE_DATE_COLUMNS.map((column) => `${column} = case when ${takes} then ${incoming}.${column} else ${held}.${column} end`).join(',\n  ');
}

const RELEASE_INSERT = `insert into releases (
    item_type, item_id, band_id, title, url, album_id, album_title, art_id, release_date, release_date_source,
    release_date_read_at, label, label_id, artist_credit, price, currency, featured_track_id, featured_track_title,
    featured_track_duration, num_streamable_tracks, also_collected_count, is_preorder, tags, first_seen_at, last_seen_at
  ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  on conflict (item_type, item_id) do update set`;

const RELEASE_CATALOG_SET = `title = excluded.title, url = excluded.url, band_id = excluded.band_id,`;

const RELEASE_SHARED_SET = `
  is_preorder = coalesce(?, releases.is_preorder),
  album_id = coalesce(excluded.album_id, releases.album_id),
  album_title = coalesce(excluded.album_title, releases.album_title),
  art_id = coalesce(excluded.art_id, releases.art_id),
  ${releaseDateSet('excluded', 'releases')},
  label = coalesce(excluded.label, releases.label),
  label_id = coalesce(excluded.label_id, releases.label_id),
  artist_credit = coalesce(excluded.artist_credit, releases.artist_credit),
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

/** Only the feed states a pre-order's missing release day; the Sweep's undated item states nothing. */
function releaseUpsertDateSource(release: ReleaseUpsert, source: Source): ReleaseDateSource | null {
  if (release.releaseDate !== null) return source === 'catalog' ? 'sweep' : 'feed';
  return source === 'per-user' && release.isPreorder === true ? 'preorder' : null;
}

/** A source silent on `is_preorder` inserts the column default and never unlearns a stated `true` on update. */
async function upsertRelease(run: Run, release: ReleaseUpsert, seenAt: string, source: Source): Promise<void> {
  const set = source === 'catalog' ? RELEASE_CATALOG_SET + RELEASE_SHARED_SET : RELEASE_SHARED_SET;
  const dateSource = releaseUpsertDateSource(release, source);
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
    dateSource,
    dateSource === null ? null : seenAt,
    release.label,
    release.labelId,
    release.artistCredit,
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
  await run(`${RELEASE_INSERT} ${set}`, values);
}

type Enrichment = {
  readonly itemType: ItemType;
  readonly itemId: number;
  readonly releaseDate: Date | null;
  readonly isPreorder: boolean | null;
  readonly numStreamableTracks: number | null;
  readonly numTracks: number | null;
  /** A page's `tralbum.artist`; the Sweep states none. */
  readonly artistCredit: string | null;
};

/**
 * An update, never an insert: a public page states a date, not a Release, save the Upcoming album a Track page names
 * (`openUpcomingAlbum`); answers whether a held row took it. The release page and the Sweep's linkless item both name
 * themselves as the date's source. A page's artist credit fills only an uncredited row and a feed entry's replaces it,
 * so the feed's wins in any fold order.
 */
// The row cannot tell a page's credit from a feed entry's, so the first page to credit an uncredited row keeps it.
async function enrichReleaseFromPage(
  run: Run,
  input: Enrichment,
  seenAt: string,
  dateSource: 'page' | 'sweep',
): Promise<boolean> {
  const dated = input.releaseDate !== null;
  const outcome = await run(
    `update releases set
       ${releaseDateSet('incoming', 'releases')},
       num_streamable_tracks = coalesce(incoming.num_streamable_tracks, releases.num_streamable_tracks),
       num_tracks = coalesce(incoming.num_tracks, releases.num_tracks),
       is_preorder = coalesce(incoming.is_preorder, releases.is_preorder),
       artist_credit = coalesce(releases.artist_credit, incoming.artist_credit),
       last_seen_at = max(releases.last_seen_at, incoming.seen_at)
     from (select ? as release_date, ? as release_date_source, ? as release_date_read_at, ? as num_streamable_tracks,
                  ? as num_tracks, ? as is_preorder, ? as artist_credit, ? as seen_at) as incoming
     where releases.item_type = ? and releases.item_id = ?`,
    [
      iso(input.releaseDate),
      dated ? dateSource : null,
      dated ? seenAt : null,
      input.numStreamableTracks,
      input.numTracks,
      flag(input.isPreorder),
      input.artistCredit,
      seenAt,
      input.itemType,
      input.itemId,
    ],
  );
  return outcome.changes > 0;
}

async function upsertFan(run: Run, fan: ParsedFan, seenAt: string): Promise<void> {
  await run(
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
async function upsertStory(run: Run, story: ParsedStory, rawDocumentId: number): Promise<void> {
  await run(
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

async function projectFeedUpdates({ db, run }: Folding, doc: RawDocument): Promise<ProjectDocumentResult> {
  let parsed: ReturnType<typeof parseFeedUpdates>;
  try {
    parsed = parseFeedUpdates(doc.payload);
  } catch (err) {
    if (err instanceof FeedPayloadError) return result('unparsable');
    throw err;
  }
  for (const page of parsed.pages) await upsertPage(run, page, doc.fetchedAt, 'per-user');
  for (const release of parsed.releases) await upsertRelease(run, release, doc.fetchedAt, 'per-user');
  for (const fan of parsed.fans) await upsertFan(run, fan, doc.fetchedAt);
  for (const story of parsed.stories) await upsertStory(run, story, doc.id);
  await foldNewReleaseCounts(db, doc, parsed);
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

/** Each `new_release` entry's count of the Tracks that play is a read of its Release for Drops. */
async function foldNewReleaseCounts(db: SQLiteDatabase, doc: RawDocument, parsed: ReturnType<typeof parseFeedUpdates>): Promise<void> {
  const counts = new Map(parsed.releases.map((release) => [`${release.itemType}:${release.itemId}`, release.numStreamableTracks]));
  for (const story of parsed.stories) {
    const tracksOut = counts.get(`${story.itemType}:${story.itemId}`);
    if (story.storyType !== 'new_release' || tracksOut === undefined || tracksOut === null) continue;
    await foldFeedTrackRead(db, doc, { itemType: story.itemType, itemId: story.itemId, tracksOut, storyDate: story.storyDate });
  }
}

/**
 * A Track page whose album is still ahead of the read's GMT day opens the album's Release, or fills one held, its date by
 * the same ranking as any page's. The title is the `album_title` the feed gave the Track, and the
 * Page, art and featured Track are the Track's own, so a Track no feed entry named an album title for opens nothing.
 */
async function openUpcomingAlbum({ db, run }: Folding, doc: RawDocument, parsed: ParsedReleasePage): Promise<boolean> {
  const album = parsed.album;
  if (album === null || album.url === null || album.releaseDate === null) return false;
  if (album.releaseDate < aheadFrom(new Date(doc.fetchedAt))) return false;
  const track = await db.getFirstAsync<{
    band_id: number;
    title: string;
    album_title: string | null;
    art_id: number | null;
    featured_track_duration: number | null;
  }>(
    `select band_id, title, album_title, art_id, featured_track_duration from releases where item_type = 't' and item_id = ?`,
    [parsed.itemId],
  );
  if (track === null || track.album_title === null) return false;
  await run(
    `insert into releases (
       item_type, item_id, band_id, title, url, art_id, release_date, release_date_source, release_date_read_at,
       featured_track_id, featured_track_title, featured_track_duration, is_preorder, first_seen_at, last_seen_at
     ) values ('a', ?, ?, ?, ?, ?, ?, 'page', ?, ?, ?, ?, ?, ?, ?)
     on conflict (item_type, item_id) do update set
       art_id = coalesce(releases.art_id, excluded.art_id),
       ${releaseDateSet('excluded', 'releases')},
       featured_track_id = coalesce(releases.featured_track_id, excluded.featured_track_id),
       featured_track_title = coalesce(releases.featured_track_title, excluded.featured_track_title),
       featured_track_duration = coalesce(releases.featured_track_duration, excluded.featured_track_duration),
       first_seen_at = min(releases.first_seen_at, excluded.first_seen_at),
       last_seen_at = max(releases.last_seen_at, excluded.last_seen_at)`,
    [
      album.itemId,
      track.band_id,
      track.album_title,
      album.url,
      track.art_id,
      album.releaseDate.toISOString(),
      doc.fetchedAt,
      parsed.itemId,
      track.title,
      track.featured_track_duration,
      flag(album.isPreorder) ?? 0,
      doc.fetchedAt,
      doc.fetchedAt,
    ],
  );
  return true;
}

async function projectReleasePage({ db, run }: Folding, doc: RawDocument): Promise<ProjectDocumentResult> {
  let parsed: ReturnType<typeof parseReleasePage>;
  try {
    parsed = parseReleasePage(doc.payload);
  } catch (err) {
    if (err instanceof ReleasePagePayloadError) return result('unparsable');
    throw err;
  }
  const enriched = await enrichReleaseFromPage(run, parsed, doc.fetchedAt, 'page');
  const opened = await openUpcomingAlbum({ db, run }, doc, parsed);
  await foldPageTrackRead(db, doc, parsed);
  await foldTrackPage(db, parsed);
  return result('projected', { releasesEnriched: enriched ? 1 : 0, releasesUpserted: opened ? 1 : 0 });
}

async function pageExists(db: SQLiteDatabase, bandId: number): Promise<boolean> {
  return (await db.getFirstAsync<{ band_id: number }>('select band_id from pages where band_id = ?', [bandId])) !== null;
}

/** An item with no link, or for a Page we hold no row for, can only fill in a Release already held (ADR-0017). */
async function projectBandDetails({ db, run }: Folding, doc: RawDocument): Promise<ProjectDocumentResult> {
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
    await upsertPage(run, page, seenAt, 'catalog');
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
        run,
        {
          ...release,
          url: release.url,
          albumId: null,
          albumTitle: null,
          label: null,
          labelId: null,
          artistCredit: null,
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
    const filled = await enrichReleaseFromPage(run, { ...release, numStreamableTracks: null, numTracks: null, artistCredit: null }, seenAt, 'sweep');
    if (filled) enriched += 1;
  }
  return result(
    'projected',
    { pagesUpserted: parsed.pages.length, releasesUpserted: upserted, releasesEnriched: enriched },
    parsed.skipped,
  );
}

/** A terminal page removes old follows only with the whole snapshot's page proof. */
async function projectFollowingBands({ db, run }: Folding, doc: RawDocument): Promise<ProjectDocumentResult> {
  let parsed: ReturnType<typeof parseFollowingBands>;
  try {
    parsed = parseFollowingBands(doc.payload);
  } catch (err) {
    if (err instanceof FollowingBandsPayloadError) {
      await invalidateSnapshot(db, doc);
      return result('unparsable');
    }
    throw err;
  }
  const seenAt = iso(parsed.snapshotStartedAt) ?? doc.fetchedAt;
  for (const bandId of parsed.bandIds) {
    await run(
      `insert into follows (band_id, first_seen_at, last_seen_at) values (?, ?, ?)
       on conflict (band_id) do update set
         first_seen_at = min(follows.first_seen_at, excluded.first_seen_at),
         last_seen_at = max(follows.last_seen_at, excluded.last_seen_at)`,
      [bandId, seenAt, seenAt],
    );
  }
  let removed = 0;
  if (parsed.snapshotStartedAt !== null && await completeSnapshot(db, doc, parsed.terminal, parsed.skipped.unparsable)) {
    const swept = await run('delete from follows where last_seen_at < ?', [parsed.snapshotStartedAt.toISOString()]);
    removed = swept.changes;
  }
  return result('projected', { followsUpserted: parsed.bandIds.length, followsRemoved: removed }, parsed.skipped);
}

/** Items carry the walk's start; only a validated complete snapshot removes older membership. */
async function projectWishlistItems({ db, run }: Folding, doc: RawDocument): Promise<ProjectDocumentResult> {
  let parsed: ReturnType<typeof parseWishlistItems>;
  try {
    parsed = parseWishlistItems(doc.payload);
  } catch (err) {
    if (err instanceof WishlistItemsPayloadError) {
      await invalidateSnapshot(db, doc);
      return result('unparsable');
    }
    throw err;
  }
  const snapshot = parsed.snapshotStartedAt.toISOString();
  for (const item of parsed.items) {
    await run(
      `insert into wishlist_items (item_type, item_id, band_id, added_at, last_seen_snapshot_at) values (?, ?, ?, ?, ?)
       on conflict (item_type, item_id) do update set
         band_id = coalesce(excluded.band_id, wishlist_items.band_id),
         added_at = coalesce(excluded.added_at, wishlist_items.added_at),
         last_seen_snapshot_at = max(excluded.last_seen_snapshot_at, wishlist_items.last_seen_snapshot_at)`,
      [item.itemType, item.itemId, item.bandId, iso(item.addedAt), snapshot],
    );
  }
  let removed = 0;
  if (await completeSnapshot(db, doc, parsed.terminal, parsed.skipped.unparsable)) {
    removed = (await run('delete from wishlist_items where last_seen_snapshot_at < ?', [snapshot])).changes;
  }
  return result('projected', { wishlistItemsUpserted: parsed.items.length, wishlistItemsRemoved: removed }, parsed.skipped);
}

/** The `fan_feed_page` extract and anything unknown is skipped and kept on the raw side for a later parser. */
async function projectRawDocument(folding: Folding, doc: RawDocument): Promise<ProjectDocumentResult> {
  switch (doc.endpoint) {
    case FEED_UPDATES_ENDPOINT:
      return projectFeedUpdates(folding, doc);
    case RELEASE_PAGE_ENDPOINT:
      return projectReleasePage(folding, doc);
    case BAND_DETAILS_ENDPOINT:
      return projectBandDetails(folding, doc);
    case FOLLOWING_BANDS_ENDPOINT:
      return projectFollowingBands(folding, doc);
    case WISHLIST_ITEMS_ENDPOINT:
      return projectWishlistItems(folding, doc);
    default:
      return result('skipped');
  }
}

type Tally = Writes & {
  documentsProcessed: number;
  documentsSkipped: number;
  documentsUnparsable: number;
  documentsFailed: number;
  skipped: MutableSkippedCounts;
};

function emptyTally(): Tally {
  return {
    ...noWrites(),
    documentsProcessed: 0,
    documentsSkipped: 0,
    documentsUnparsable: 0,
    documentsFailed: 0,
    skipped: { unknownStoryType: 0, unparsable: 0, missingFanInfo: 0 },
  };
}

function tallyDocument(tally: Tally, outcome: ProjectDocumentResult | 'failed'): void {
  if (outcome === 'failed') {
    tally.documentsFailed += 1;
    return;
  }
  if (outcome.outcome === 'projected') tally.documentsProcessed += 1;
  if (outcome.outcome === 'skipped') tally.documentsSkipped += 1;
  if (outcome.outcome === 'unparsable') tally.documentsUnparsable += 1;
  for (const key of Object.keys(noWrites()) as (keyof Writes)[]) tally[key] += outcome[key];
  tally.skipped.unknownStoryType += outcome.skipped.unknownStoryType;
  tally.skipped.unparsable += outcome.skipped.unparsable;
  tally.skipped.missingFanInfo += outcome.skipped.missingFanInfo;
}

/**
 * SQLite's messages for a store that failed, not a document: full, I/O, memory, interrupt, corruption, lock, open and
 * read-only. Matched on the message, since expo-sqlite's Android binding prints the code as a character.
 */
const STORE_FAILURE =
  /database or disk is full|disk I\/O error|out of memory|interrupted|database disk image is malformed|file is not a database|database (table )?is locked|unable to open database file|readonly database|locking protocol/i;

function storeFailed(error: unknown): boolean {
  return error instanceof Error && STORE_FAILURE.test(error.message);
}

/**
 * One document behind a savepoint, then its cursor. A throw from its fold is the document's own outcome: its writes
 * roll back, its id and the error's name go to `projection_failures`, and the cursor passes it, so the documents after
 * it still fold (ARCH-M1). A store failure, which the next fold may not meet, and a throw that also ended the
 * transaction, which leaves no savepoint to roll back to, fail the stretch with the cursor where it was.
 */
async function foldDocument(folding: Folding, doc: RawDocument): Promise<ProjectDocumentResult | 'failed'> {
  const { db, run } = folding;
  let outcome: ProjectDocumentResult | 'failed';
  await db.execAsync('savepoint fold_document');
  try {
    outcome = await projectRawDocument(folding, doc);
  } catch (error) {
    if (storeFailed(error)) throw error;
    try {
      await db.execAsync('rollback to fold_document');
    } catch {
      throw error;
    }
    await run(
      `insert into projection_failures (raw_document_id, endpoint, error) values (?, ?, ?)
       on conflict (raw_document_id) do update set error = excluded.error`,
      [doc.id, doc.endpoint, error instanceof Error ? error.name : typeof error],
    );
    await invalidateSnapshot(db, doc);
    reportCode('fold_failed', error);
    outcome = 'failed';
  }
  await db.execAsync('release fold_document');
  await run(
    `insert into projection_observation_progress (endpoint, last_observation_id) values (?, ?)
     on conflict (endpoint) do update set last_observation_id = max(projection_observation_progress.last_observation_id, excluded.last_observation_id)`,
    [doc.endpoint, doc.observationId],
  );
  await run(
    `insert into projection_progress (endpoint, last_raw_id) values (?, ?)
     on conflict (endpoint) do update set last_raw_id = max(projection_progress.last_raw_id, excluded.last_raw_id)`,
    [doc.endpoint, doc.id],
  );
  return outcome;
}

/**
 * An update that matches no row still takes the write lock. Expo opens a transaction with a deferred `begin`, and in
 * WAL one that read before another connection committed cannot then write, so each stretch takes the lock before it
 * lists what to fold.
 */
const TAKE_WRITE_LOCK = 'update projection_observation_progress set last_observation_id = last_observation_id where 0';

type FoldOptions = { readonly stretchMs: number; readonly connection: FoldConnection; readonly onProgress?: ReplayProgress };

/**
 * Folds every document past the cursors in stretches of about `stretchMs`, at least one document each, listing
 * inside the stretch's lock so two folds that overlap never fold one document twice. `onProgress` hears after each
 * stretch that leaves documents waiting.
 */
async function foldStretches(db: SQLiteDatabase, { stretchMs, connection, onProgress }: FoldOptions): Promise<FoldSummary> {
  const tally = emptyTally();
  const counted = onProgress === undefined ? null : await countForProjection(db);
  let folded = 0;
  for (let more = true; more; ) {
    more = false;
    await withFoldLock(
      db,
      async (txn) => {
        await txn.execAsync(`pragma busy_timeout = ${BUSY_TIMEOUT_MS}; ${TAKE_WRITE_LOCK};`);
        const statements = statementsFor(txn);
        try {
          const started = Date.now();
          let batch = await listForProjection(txn, FOLD_BATCH_SIZE);
          while (batch.length > 0 && !more) {
            for (const doc of batch) {
              tallyDocument(tally, await foldDocument({ db: txn, run: statements.run }, doc));
              folded += 1;
              more = Date.now() - started >= stretchMs;
              if (more) break;
            }
            if (!more) batch = await listForProjection(txn, FOLD_BATCH_SIZE);
          }
        } finally {
          await statements.finalize();
        }
      },
      connection,
    );
    // oxlint-disable-next-line typescript/no-unnecessary-condition -- withFoldLock's callback sets more, which narrowing cannot see
    if (more && counted !== null) onProgress?.(counted.held - counted.waiting + folded, counted.held);
  }
  return { ...tally, skipped: { ...tally.skipped } };
}

export function fold(db: SQLiteDatabase): Promise<FoldSummary> {
  return foldStretches(db, { stretchMs: FOLD_STRETCH_MS, connection: 'own' });
}

/** The replay's fold, then the version written and the marker cleared in one transaction. */
async function replay(db: SQLiteDatabase, onProgress?: ReplayProgress): Promise<FoldSummary> {
  const summary = await foldStretches(db, { stretchMs: REPLAY_STRETCH_MS, connection: 'main', onProgress });
  await withFoldLock(
    db,
    async (txn) => {
      await txn.runAsync('insert into kv (key, value) values (?, ?) on conflict (key) do update set value = excluded.value', [
        PROJECTION_VERSION_KEY,
        JSON.stringify(PROJECTION_VERSION),
      ]);
      await txn.runAsync('delete from kv where key = ?', [PROJECTION_REBUILDING_KEY]);
    },
    'main',
  );
  return summary;
}

/**
 * The launch replay, on the main connection, which nothing else uses until it ends. `band_sweeps` and `kv` are the
 * Fetcher's own state, which no Raw Document could bring back, so they stay.
 */
export async function rebuild(db: SQLiteDatabase, onProgress?: ReplayProgress): Promise<FoldSummary> {
  await withFoldLock(
    db,
    async (txn) => {
      await txn.execAsync(`
        delete from stories;
        delete from drops;
        delete from releases;
        delete from pages;
        delete from fans;
        delete from wishlist_items;
        delete from follows;
        delete from projection_progress;
        delete from projection_observation_progress;
        delete from projection_failures;
        delete from projection_snapshots;
      `);
      await txn.runAsync('insert into kv (key, value) values (?, ?) on conflict (key) do update set value = excluded.value', [
        PROJECTION_REBUILDING_KEY,
        JSON.stringify(PROJECTION_VERSION),
      ]);
    },
    'main',
  );
  return replay(db, onProgress);
}

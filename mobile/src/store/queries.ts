/**
 * The read side: the web's view response shapes built on the phone from the Projection by the ported feed rules, plus the sweep
 * queue's reads and writes (task 0036). Every judgement is the domain's; this file only hands it flat rows, and each view
 * only the Releases its rules could pick, each with all its Stories, so it answers as over the whole store (perf.check.ts).
 */
import type { SQLiteBindValue, SQLiteDatabase } from 'expo-sqlite';
import type {
  ApiBoughtCrossedResponse,
  ApiBoughtResponse,
  ApiCuratedResponse,
  ApiItemType,
  ApiReleaseTracksResponse,
  ApiUser,
  ApiWishlistResponse,
} from '../domain/apiTypes';
import { assembleFeed, itemKey } from '../domain/assemble';
import { buildBoughtChart } from '../domain/boughtChart';
import { buildCrossedList, CROSSED_MAX_THRESHOLD, CROSSED_MIN_THRESHOLD } from '../domain/boughtCrossed';
import {
  buildCurated,
  CURATED_MIN_BUYERS,
  CURATED_NEW_MAX,
  CURATED_QUOTES_MAX,
  CURATED_WINDOW_DAYS,
} from '../domain/curate';
import { buildNewReleases, type NewReleasesView } from '../domain/newReleases';
import { storedBandId, storedTralbum } from '../domain/releasePage';
import type { FeedStoryRow, UpcomingReleaseRow } from '../domain/rows';
import { intervalFor, readDiscographyDates, type SweepTier, tierFor } from '../domain/sweep';
import { readTralbumTracks } from '../domain/tralbumTracks';
import type { ItemType, StoryType } from '../domain/types';
import { aheadFrom, buildUpcoming, handoffFloor, UPCOMING_MAX_RELEASES } from '../domain/upcoming';
import { IDENTITY_KEY, readKv, type StoredIdentity } from './kv';
import { lastFetchedAt, latestReleasePageDocument } from './rawDocuments';

/** A ceiling on one read's Stories, not a page size: the rules fold what a view needs in memory, as the server does (ADR-0005). */
export const FEED_MAX_STORY_ROWS = 50_000;

const DAY_MS = 24 * 60 * 60_000;

export const STREAM_URL_TTL_MS = DAY_MS;

function asItemType(value: string): ItemType | null {
  return value === 'a' || value === 't' ? value : null;
}

function asStoryType(value: string): StoryType | null {
  return value === 'purchase' || value === 'new_release' || value === 'wishlist' ? value : null;
}

function asDate(value: string | null): Date | null {
  if (value === null) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

type StoryRecord = {
  story_id: number;
  story_type: string;
  story_date: string;
  review_text: string | null;
  fan_id: number | null;
  item_type: string;
  item_id: number;
};

type ReleaseRecord = {
  item_type: string;
  item_id: number;
  band_id: number;
  title: string;
  url: string;
  art_id: number | null;
  release_date: string | null;
  label: string | null;
  featured_track_id: number | null;
  featured_track_title: string | null;
  featured_track_duration: number | null;
  num_streamable_tracks: number | null;
  artist: string;
};

type FanRecord = { fan_id: number; username: string; name: string | null; image_id: number | null };

type ReleasePart = Omit<FeedStoryRow, 'storyId' | 'storyType' | 'storyDate' | 'reviewText' | 'fanId' | 'fanUsername' | 'fanName' | 'fanImageId'>;

/** A Story reaches the views only with its Release and that Release's Page held, as the server's inner joins say. */
const STORY_JOIN = `stories s
  join releases r on r.item_type = s.item_type and r.item_id = s.item_id
  join pages p on p.band_id = r.band_id`;

/** Which Stories a view loads: a `where` over `stories s`, and its values. */
type StoryScope = { readonly where: string; readonly params: readonly SQLiteBindValue[] };

const ALL_STORIES: StoryScope = { where: '1 = 1', params: [] };

type ItemPair = readonly [ItemType, number];

/** Every Story of the listed Releases; a view that judges whole Releases loads only its candidates this way. */
function storiesOfItems(items: readonly ItemPair[]): StoryScope {
  return {
    where: `(s.item_type, s.item_id) in (select json_extract(value, '$[0]'), json_extract(value, '$[1]') from json_each(?))`,
    params: [JSON.stringify(items)],
  };
}

function toReleasePart(row: ReleaseRecord): ReleasePart | null {
  const itemType = asItemType(row.item_type);
  if (itemType === null) return null;
  return {
    itemType,
    itemId: row.item_id,
    bandId: row.band_id,
    title: row.title,
    url: row.url,
    artId: row.art_id,
    releaseDate: asDate(row.release_date),
    label: row.label,
    featuredTrackId: row.featured_track_id,
    featuredTrackTitle: row.featured_track_title,
    featuredTrackDuration: row.featured_track_duration,
    numStreamableTracks: row.num_streamable_tracks,
    artist: row.artist,
  };
}

/**
 * The Stories in `scope`, newest action first, as the flat rows the feed rules read. Stories cross narrow and each
 * Release and Fan crosses once, however many Stories share it: the wide join repeated every Release column per Story.
 */
async function loadStoryRows(db: SQLiteDatabase, scope: StoryScope, limit: number = FEED_MAX_STORY_ROWS): Promise<readonly FeedStoryRow[]> {
  const stories = await db.getAllAsync<StoryRecord>(
    `select s.id as story_id, s.story_type, s.story_date, s.review_text, s.fan_id, s.item_type, s.item_id
     from stories s
     where ${scope.where}
     order by s.story_date desc, s.id desc
     limit ?`,
    [...scope.params, limit],
  );
  const items = new Map<string, ItemPair>();
  const fanIds = new Set<number>();
  for (const story of stories) {
    const itemType = asItemType(story.item_type);
    if (itemType !== null) items.set(`${itemType}:${story.item_id}`, [itemType, story.item_id]);
    if (story.fan_id !== null) fanIds.add(story.fan_id);
  }
  const releaseRows = await db.getAllAsync<ReleaseRecord>(
    `select r.item_type, r.item_id, r.band_id, r.title, r.url, r.art_id, r.release_date, r.label,
            r.featured_track_id, r.featured_track_title, r.featured_track_duration, r.num_streamable_tracks,
            p.name as artist
     from json_each(?) k
     join releases r on r.item_type = json_extract(k.value, '$[0]') and r.item_id = json_extract(k.value, '$[1]')
     join pages p on p.band_id = r.band_id`,
    [JSON.stringify([...items.values()])],
  );
  const fanRows = await db.getAllAsync<FanRecord>(
    'select fan_id, username, name, image_id from fans where fan_id in (select value from json_each(?))',
    [JSON.stringify([...fanIds])],
  );
  const releases = new Map<string, ReleasePart>();
  for (const row of releaseRows) {
    const part = toReleasePart(row);
    if (part !== null) releases.set(`${part.itemType}:${part.itemId}`, part);
  }
  const fans = new Map(fanRows.map((fan) => [fan.fan_id, fan]));

  const rows: FeedStoryRow[] = [];
  for (const story of stories) {
    const storyType = asStoryType(story.story_type);
    const storyDate = asDate(story.story_date);
    // No Release or Page held leaves the Story out, as the inner join did; a rebuild between the reads does the same.
    const release = releases.get(`${story.item_type}:${story.item_id}`);
    if (storyType === null || storyDate === null || release === undefined) continue;
    const fan = story.fan_id === null ? undefined : fans.get(story.fan_id);
    rows.push({
      storyId: story.story_id,
      storyType,
      storyDate,
      reviewText: story.review_text,
      fanId: fan?.fan_id ?? null,
      fanUsername: fan?.username ?? null,
      fanName: fan?.name ?? null,
      fanImageId: fan?.image_id ?? null,
      itemType: release.itemType,
      itemId: release.itemId,
      bandId: release.bandId,
      title: release.title,
      url: release.url,
      artId: release.artId,
      releaseDate: release.releaseDate,
      label: release.label,
      featuredTrackId: release.featuredTrackId,
      featuredTrackTitle: release.featuredTrackTitle,
      featuredTrackDuration: release.featuredTrackDuration,
      numStreamableTracks: release.numStreamableTracks,
      artist: release.artist,
    });
  }
  return rows;
}

/** Every Story, newest action first, with its Release, that Release's Page and the acting Fan joined on. */
export async function listStoryRows(db: SQLiteDatabase, limit: number = FEED_MAX_STORY_ROWS): Promise<readonly FeedStoryRow[]> {
  return loadStoryRows(db, ALL_STORIES, limit);
}

type UpcomingRecord = {
  item_type: string;
  item_id: number;
  band_id: number;
  title: string;
  url: string;
  art_id: number | null;
  release_date: string;
  is_preorder: number;
  label: string | null;
  featured_track_id: number | null;
  featured_track_title: string | null;
  featured_track_duration: number | null;
  num_streamable_tracks: number | null;
  artist: string;
};

/**
 * Releases dated ahead of today's GMT day, or out within the handoff and held
 * before they came out, whose Page is followed or which a Story reaches (ADR-0017).
 */
export async function listUpcomingReleases(db: SQLiteDatabase, now: Date): Promise<readonly UpcomingReleaseRow[]> {
  const rows = await db.getAllAsync<UpcomingRecord>(
    `select r.item_type, r.item_id, r.band_id, r.title, r.url, r.art_id, r.release_date, r.is_preorder, r.label,
            r.featured_track_id, r.featured_track_title, r.featured_track_duration, r.num_streamable_tracks,
            p.name as artist
     from releases r
     join pages p on p.band_id = r.band_id
     where r.release_date >= ?
       and (r.release_date >= ? or r.first_seen_at < r.release_date)
       and (exists (select 1 from follows f where f.band_id = r.band_id)
            or exists (select 1 from stories s where s.item_type = r.item_type and s.item_id = r.item_id))
     order by r.release_date asc, r.item_type asc, r.item_id asc
     limit ?`,
    [handoffFloor(now).toISOString(), aheadFrom(now).toISOString(), UPCOMING_MAX_RELEASES],
  );
  return rows.flatMap((row) => {
    const itemType = asItemType(row.item_type);
    const releaseDate = asDate(row.release_date);
    if (itemType === null || releaseDate === null) return [];
    return [
      {
        itemType,
        itemId: row.item_id,
        bandId: row.band_id,
        title: row.title,
        url: row.url,
        artId: row.art_id,
        releaseDate,
        isPreorder: row.is_preorder === 1,
        label: row.label,
        featuredTrackId: row.featured_track_id,
        featuredTrackTitle: row.featured_track_title,
        featuredTrackDuration: row.featured_track_duration,
        numStreamableTracks: row.num_streamable_tracks,
        artist: row.artist,
      },
    ];
  });
}

export type OverviewView = {
  /** Null until the Fetcher's probe has answered as a Fan. */
  readonly user: ApiUser | null;
  readonly updatedAt: string | null;
  /** The Pages this Fan's own Stories reach, the server's "All pages" number. */
  readonly pageCount: number;
  readonly followCount: number;
  readonly releaseCount: number;
  readonly storyCount: number;
};

export async function readOverview(db: SQLiteDatabase): Promise<OverviewView> {
  const identity = await readKv<StoredIdentity>(db, IDENTITY_KEY);
  const counts = await db.getFirstAsync<{ pages: number; follows: number; releases: number; stories: number }>(
    `select
       (select count(distinct r.band_id) from stories s
          join releases r on r.item_type = s.item_type and r.item_id = s.item_id) as pages,
       (select count(*) from follows) as follows,
       (select count(*) from releases) as releases,
       (select count(*) from stories) as stories`,
  );
  return {
    user:
      identity === null
        ? null
        : { username: identity.username, displayName: identity.name, avatarUrl: identity.avatarUrl },
    updatedAt: await lastFetchedAt(db),
    pageCount: counts?.pages ?? 0,
    followCount: counts?.follows ?? 0,
    releaseCount: counts?.releases ?? 0,
    storyCount: counts?.stories ?? 0,
  };
}

/**
 * The web's New releases view in one read: `/api/upcoming` split at today's
 * GMT day, and the new-release Feed Items (everything, anchor sort) filed into weeks.
 */
export async function readNewReleases(db: SQLiteDatabase, options: { readonly now: Date }): Promise<NewReleasesView> {
  const releases = await listUpcomingReleases(db, options.now);
  const upcomingItems = storiesOfItems(releases.map((release) => [release.itemType, release.itemId]));
  // The new-release filter drops every other type before Bursts, so the view's elements need only those Stories.
  const rows = await loadStoryRows(db, {
    where: `s.story_type = 'new_release' or ${upcomingItems.where}`,
    params: upcomingItems.params,
  });
  const { elements } = assembleFeed(rows, { types: ['new_release'], sort: 'anchor' });
  const wanted = new Set(releases.map(itemKey));
  const upcoming = buildUpcoming(releases, rows.filter((row) => wanted.has(itemKey(row))));
  return buildNewReleases(elements, upcoming, options.now);
}

export type BoughtOptions =
  | { readonly mode: 'released'; readonly now?: Date }
  | { readonly mode: 'crossed'; readonly threshold: number; readonly now?: Date };

/** A purchase Story whose Fan is held: the only kind the Bought rules count as a buyer. */
const NAMED_PURCHASES = `stories b join fans f on f.fan_id = b.fan_id where b.story_type = 'purchase'`;

/**
 * Every week or crossing at once: the phone has no page boundary, so `nextCursor` is always null. Only a Release the
 * rules could place is loaded, each with all its Stories, so the domain judges exactly what it judged over the whole store.
 */
export async function readBought(db: SQLiteDatabase, options: { readonly mode: 'released'; readonly now?: Date }): Promise<ApiBoughtResponse>;
export async function readBought(
  db: SQLiteDatabase,
  options: { readonly mode: 'crossed'; readonly threshold: number; readonly now?: Date },
): Promise<ApiBoughtCrossedResponse>;
export async function readBought(db: SQLiteDatabase, options: BoughtOptions): Promise<ApiBoughtResponse | ApiBoughtCrossedResponse> {
  // ceiling: Bought still loads most Stories (43 ms at 10,000 on the Mac); a per-Release row the fold keeps is the upgrade (V2-PLAN section 2, point 4).
  if (options.mode === 'released') {
    const rows = await loadStoryRows(db, {
      where: `(s.item_type, s.item_id) in (
        select b.item_type, b.item_id from ${NAMED_PURCHASES}
          and exists (select 1 from releases r where r.item_type = b.item_type and r.item_id = b.item_id and r.release_date is not null))`,
      params: [],
    });
    return { weeks: buildBoughtChart(rows), nextCursor: null };
  }
  const threshold = Math.min(CROSSED_MAX_THRESHOLD, Math.max(CROSSED_MIN_THRESHOLD, Math.trunc(options.threshold)));
  const rows = await loadStoryRows(db, {
    where: `(s.item_type, s.item_id) in (
      select b.item_type, b.item_id from ${NAMED_PURCHASES}
      group by b.item_type, b.item_id having count(distinct b.fan_id) >= ?)`,
    params: [threshold],
  });
  return { entries: buildCrossedList(rows, threshold), nextCursor: null };
}

/**
 * The Releases each Curated module could pick, as a superset: the newest Story's (the window's clock), those with two
 * windowed buyers, the newest announcements down to the fifth date with its ties, and the newest reviews.
 */
async function curatedCandidates(db: SQLiteDatabase): Promise<readonly ItemPair[] | null> {
  const newest = await db.getFirstAsync<{ at: string | null }>(`select max(s.story_date) as at from ${STORY_JOIN}`);
  const newestAt = asDate(newest?.at ?? null);
  if (newestAt === null) return null;
  const since = new Date(newestAt.getTime() - CURATED_WINDOW_DAYS * DAY_MS).toISOString();
  const rows = await db.getAllAsync<{ item_type: string; item_id: number }>(
    `with announced as (
       select s.item_type, s.item_id, max(s.story_date) as at from ${STORY_JOIN}
       where s.story_type = 'new_release' group by s.item_type, s.item_id
     )
     select item_type, item_id from (select s.item_type, s.item_id from ${STORY_JOIN} order by s.story_date desc, s.id desc limit 1)
     union
     select b.item_type, b.item_id from ${NAMED_PURCHASES} and b.story_date >= ?
       group by b.item_type, b.item_id having count(distinct b.fan_id) >= ?
     union
     select item_type, item_id from announced
       where at >= coalesce((select at from announced order by at desc limit 1 offset ?), '')
     union
     select item_type, item_id from (
       select s.item_type, s.item_id from ${STORY_JOIN} join fans f on f.fan_id = s.fan_id
       where s.story_type = 'purchase' and s.review_text is not null
       order by s.story_date desc, s.id desc limit ?
     )`,
    [since, CURATED_MIN_BUYERS, CURATED_NEW_MAX - 1, CURATED_QUOTES_MAX],
  );
  return rows.flatMap((row) => {
    const itemType = asItemType(row.item_type);
    return itemType === null ? [] : [[itemType, row.item_id] as const];
  });
}

/** The Curated rules keep their own clock, the newest Story held, so `now` is accepted and not read. */
export async function readCurated(db: SQLiteDatabase, _options: { readonly now?: Date } = {}): Promise<ApiCuratedResponse> {
  const candidates = await curatedCandidates(db);
  return buildCurated(candidates === null ? [] : await loadStoryRows(db, storiesOfItems(candidates)));
}

export type WishlistKey = { readonly itemType: ApiItemType; readonly itemId: string };

/**
 * Membership as Bandcamp's own wishlist last said. With keys, one answer per
 * key; without, every item held. `pending` is the wishlist exchange's to fill.
 */
export async function readWishlistState(db: SQLiteDatabase, keys?: readonly WishlistKey[]): Promise<ApiWishlistResponse> {
  const rows = await db.getAllAsync<{ item_type: string; item_id: number }>(
    'select item_type, item_id from wishlist_items order by item_type, item_id',
  );
  const held = new Set(rows.map((row) => `${row.item_type}:${row.item_id}`));
  if (keys === undefined) {
    return {
      items: rows.flatMap((row) => {
        const itemType = asItemType(row.item_type);
        return itemType === null ? [] : [{ itemType, itemId: String(row.item_id), wishlisted: true, pending: null }];
      }),
    };
  }
  return {
    items: keys.map((key) => ({
      itemType: key.itemType,
      itemId: key.itemId,
      wishlisted: held.has(`${key.itemType}:${key.itemId}`),
      pending: null,
    })),
  };
}

/**
 * The player's tracklist off the newest stored release page, or null when none
 * is held; the caller refetches once `expiresAt` has passed (ADR-0015).
 */
export async function readTracklist(db: SQLiteDatabase, itemType: ItemType, itemId: number): Promise<ApiReleaseTracksResponse | null> {
  const doc = await latestReleasePageDocument(db, itemType, itemId);
  if (doc === null) return null;
  let bandId = storedBandId(doc.payload);
  if (bandId === null) {
    const release = await db.getFirstAsync<{ band_id: number }>(
      'select band_id from releases where item_type = ? and item_id = ?',
      [itemType, itemId],
    );
    bandId = release?.band_id ?? null;
  }
  if (bandId === null) return null;
  const fetchedAt = new Date(doc.fetchedAt);
  return {
    itemType,
    itemId: String(itemId),
    bandId: String(bandId),
    fetchedAt: fetchedAt.toISOString(),
    expiresAt: new Date(fetchedAt.getTime() + STREAM_URL_TTL_MS).toISOString(),
    tracks: readTralbumTracks(storedTralbum(doc.payload)),
  };
}

export type FollowedPage = {
  readonly bandId: number;
  /** Null for a followed Page no feed page or discography has named yet. */
  readonly name: string | null;
  readonly url: string | null;
};

export async function readFollowedBands(db: SQLiteDatabase): Promise<readonly FollowedPage[]> {
  const rows = await db.getAllAsync<{ band_id: number; name: string | null; url: string | null }>(
    `select f.band_id, p.name, p.url from follows f
     left join pages p on p.band_id = f.band_id
     order by p.name is null, p.name collate nocase, f.band_id`,
  );
  return rows.map((row) => ({ bandId: row.band_id, name: row.name, url: row.url }));
}

export type SweepDue = {
  readonly bandId: number;
  readonly tier: SweepTier;
  readonly lastSweptAt: string | null;
  readonly failures: number;
};

function asTier(value: string): SweepTier {
  return value === 'hot' || value === 'warm' ? value : 'cold';
}

/** Followed Pages owed a discography read by their tier's interval, never-swept first, then oldest (ADR-0017). */
export async function readSweepDue(db: SQLiteDatabase, now: Date, limit: number): Promise<readonly SweepDue[]> {
  const cutoff = (tier: SweepTier): string => new Date(now.getTime() - intervalFor(tier)).toISOString();
  const rows = await db.getAllAsync<{ band_id: number; tier: string; last_swept_at: string | null; failures: number }>(
    `select f.band_id, coalesce(b.tier, 'cold') as tier, b.last_swept_at, coalesce(b.failures, 0) as failures
     from follows f
     left join band_sweeps b on b.band_id = f.band_id
     where b.last_swept_at is null
        or (b.tier = 'hot' and b.last_swept_at <= ?)
        or (b.tier = 'warm' and b.last_swept_at <= ?)
        or (b.tier not in ('hot', 'warm') and b.last_swept_at <= ?)
     order by b.last_swept_at is not null, b.last_swept_at, f.band_id
     limit ?`,
    [cutoff('hot'), cutoff('warm'), cutoff('cold'), limit],
  );
  return rows.map((row) => ({
    bandId: row.band_id,
    tier: asTier(row.tier),
    lastSweptAt: row.last_swept_at,
    failures: row.failures,
  }));
}

export type SweepOutcome =
  | { readonly bandId: number; readonly at: Date; readonly outcome: 'swept'; readonly bandDetails: unknown }
  | { readonly bandId: number; readonly at: Date; readonly outcome: 'gone' | 'failed' };

/**
 * Books a band's sweep: a read discography sets the tier from its own dates, a
 * 404 or 410 is cold, and a failure keeps the tier and counts.
 */
export async function markSwept(db: SQLiteDatabase, input: SweepOutcome): Promise<void> {
  const at = input.at.toISOString();
  if (input.outcome === 'failed') {
    await db.runAsync(
      `insert into band_sweeps (band_id, last_swept_at, tier, failures) values (?, ?, 'cold', 1)
       on conflict (band_id) do update set last_swept_at = excluded.last_swept_at, failures = band_sweeps.failures + 1`,
      [input.bandId, at],
    );
    return;
  }
  const tier = input.outcome === 'swept' ? tierFor(readDiscographyDates(input.bandDetails), input.at) : 'cold';
  await db.runAsync(
    `insert into band_sweeps (band_id, last_swept_at, tier, failures) values (?, ?, ?, 0)
     on conflict (band_id) do update set last_swept_at = excluded.last_swept_at, tier = excluded.tier, failures = 0`,
    [input.bandId, at, tier],
  );
}

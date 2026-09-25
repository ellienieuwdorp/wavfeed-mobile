/**
 * The read side: the web's view response shapes built on the phone from the Projection by the ported feed rules, plus the sweep
 * queue's reads and writes (task 0036). Every judgement is the domain's; this file only hands it flat rows.
 */
import type { SQLiteDatabase } from 'expo-sqlite';
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
import { buildCurated } from '../domain/curate';
import { buildNewReleases, type NewReleasesView } from '../domain/newReleases';
import { storedBandId, storedTralbum } from '../domain/releasePage';
import type { FeedStoryRow, UpcomingReleaseRow } from '../domain/rows';
import { intervalFor, readDiscographyDates, type SweepTier, tierFor } from '../domain/sweep';
import { readTralbumTracks } from '../domain/tralbumTracks';
import type { ItemType, StoryType } from '../domain/types';
import { aheadFrom, buildUpcoming, handoffFloor, UPCOMING_MAX_RELEASES } from '../domain/upcoming';
import { IDENTITY_KEY, readKv, type StoredIdentity } from './kv';
import { lastFetchedAt, latestReleasePageDocument } from './rawDocuments';

/** A ceiling, not a page size: the phone reads the whole history and the rules fold it in memory, as the server does (ADR-0005). */
export const FEED_MAX_STORY_ROWS = 50_000;

export const STREAM_URL_TTL_MS = 24 * 60 * 60_000;

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

type StoryRowRecord = {
  story_id: number;
  story_type: string;
  story_date: string;
  review_text: string | null;
  fan_id: number | null;
  fan_username: string | null;
  fan_name: string | null;
  fan_image_id: number | null;
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

function toStoryRow(row: StoryRowRecord): FeedStoryRow | null {
  const storyType = asStoryType(row.story_type);
  const itemType = asItemType(row.item_type);
  const storyDate = asDate(row.story_date);
  if (storyType === null || itemType === null || storyDate === null) return null;
  return {
    storyId: row.story_id,
    storyType,
    storyDate,
    reviewText: row.review_text,
    fanId: row.fan_id,
    fanUsername: row.fan_username,
    fanName: row.fan_name,
    fanImageId: row.fan_image_id,
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

/** Every Story, newest action first, with its Release, that Release's Page and the acting Fan joined on. */
export async function listStoryRows(db: SQLiteDatabase, limit: number = FEED_MAX_STORY_ROWS): Promise<readonly FeedStoryRow[]> {
  const rows = await db.getAllAsync<StoryRowRecord>(
    `select s.id as story_id, s.story_type, s.story_date, s.review_text,
            f.fan_id, f.username as fan_username, f.name as fan_name, f.image_id as fan_image_id,
            r.item_type, r.item_id, r.band_id, r.title, r.url, r.art_id, r.release_date, r.label,
            r.featured_track_id, r.featured_track_title, r.featured_track_duration, r.num_streamable_tracks,
            p.name as artist
     from stories s
     join releases r on r.item_type = s.item_type and r.item_id = s.item_id
     join pages p on p.band_id = r.band_id
     left join fans f on f.fan_id = s.fan_id
     order by s.story_date desc, s.id desc
     limit ?`,
    [limit],
  );
  return rows.flatMap((row) => toStoryRow(row) ?? []);
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
  const rows = await listStoryRows(db);
  const { elements } = assembleFeed(rows, { view: 'everything', types: ['new_release'], sort: 'anchor' });
  const releases = await listUpcomingReleases(db, options.now);
  const wanted = new Set(releases.map(itemKey));
  const upcoming = buildUpcoming(releases, rows.filter((row) => wanted.has(itemKey(row))));
  return buildNewReleases(elements, upcoming, options.now);
}

export type BoughtOptions =
  | { readonly mode: 'released'; readonly now?: Date }
  | { readonly mode: 'crossed'; readonly threshold: number; readonly now?: Date };

/** Every week or crossing at once: the phone has no page boundary, so `nextCursor` is always null. */
export async function readBought(db: SQLiteDatabase, options: { readonly mode: 'released'; readonly now?: Date }): Promise<ApiBoughtResponse>;
export async function readBought(
  db: SQLiteDatabase,
  options: { readonly mode: 'crossed'; readonly threshold: number; readonly now?: Date },
): Promise<ApiBoughtCrossedResponse>;
export async function readBought(db: SQLiteDatabase, options: BoughtOptions): Promise<ApiBoughtResponse | ApiBoughtCrossedResponse> {
  const rows = await listStoryRows(db);
  if (options.mode === 'released') return { weeks: buildBoughtChart(rows), nextCursor: null };
  const threshold = Math.min(CROSSED_MAX_THRESHOLD, Math.max(CROSSED_MIN_THRESHOLD, Math.trunc(options.threshold)));
  return { entries: buildCrossedList(rows, threshold), nextCursor: null };
}

/** The Curated rules keep their own clock, the newest Story held, so `now` is accepted and not read. */
export async function readCurated(db: SQLiteDatabase, _options: { readonly now?: Date } = {}): Promise<ApiCuratedResponse> {
  return buildCurated(await listStoryRows(db));
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

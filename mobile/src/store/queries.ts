/**
 * The read side: the web's view response shapes built on the phone from the Projection by the ported feed rules, plus the sweep
 * queue's reads and writes. Every judgement is the domain's; this file only hands it flat rows, and each view
 * only the Releases its rules could pick, each with all its Stories, so it answers as over the whole store (perf.check.ts).
 */
import type { SQLiteBindValue, SQLiteDatabase } from 'expo-sqlite';
import type {
  CuratedFeed,
  ReleaseTracks,
  FeedTag,
  WishlistState,
} from '../domain/views';
import { onBandcampHost } from '../bandcamp/wire';
import {
  buildCurated,
  CURATED_MIN_BUYERS,
  CURATED_NEW_MAX,
  CURATED_QUOTES_MAX,
  CURATED_WINDOW_DAYS,
} from '../domain/curate';
import { FEED_UPDATES_ENDPOINT } from '../domain/endpoints';
import { newReleasesOf, type NewReleasesView } from '../domain/newReleases';
import { storedBandId, storedTralbum } from '../domain/releasePage';
import type { DropRow, FeedStoryRow, UpcomingReleaseRow } from '../domain/rows';
import { intervalFor, readDiscographyDates, type SweepTier, tierFor } from '../domain/sweep';
import { readTralbumTracks } from '../domain/tralbumTracks';
import type { ItemType, StoryType } from '../domain/types';
import { aheadFrom, handoffFloor, UPCOMING_MAX_RELEASES } from '../domain/upcoming';
import { DAY_MS } from '../lib/time';
import { trackIds } from './drops';
import { lastFetchedAt, latestReleasePageDocument } from './rawDocuments';

/** The diagnostic raw Story listing's default bound; selected-Release view reads keep every Story. */
export const FEED_MAX_STORY_ROWS = 50_000;

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
  num_tracks: number | null;
  is_preorder: number;
  on_release_day: number;
  page_name: string;
  artist_credit: string | null;
  tags: string;
};

type FanRecord = { fan_id: number; username: string; name: string | null; image_id: number | null };

type ReleasePart = Omit<FeedStoryRow, 'storyId' | 'storyType' | 'storyDate' | 'reviewText' | 'fanId' | 'fanUsername' | 'fanName' | 'fanImageId'>;

/** Held before its release day: the Upcoming handoff's test (ADR-0017), and whether a page's date places a Feed Item. */
export const HELD_BEFORE_OUT = 'r.first_seen_at < r.release_date';

/** Whether New releases places a Feed Item on its release day (`FeedStoryRow.onReleaseDay`). */
export const ON_RELEASE_DAY = `(r.release_date is not null and (r.release_date_source = 'feed' or ${HELD_BEFORE_OUT}))`;

/** A Story reaches the views only with its Release and that Release's Page held, as the server's inner joins say. */
const STORY_JOIN = `stories s
  join releases r on r.item_type = s.item_type and r.item_id = s.item_id
  join pages p on p.band_id = r.band_id`;

/**
 * Which Stories a view loads: a `where` over `stories s`, its values, and any `with` clause it reads. `onAlbums` reads a
 * Story of a Track dated before its held album's release day as the album's, so its Fan is a buyer of the album; New releases asks for it, the feed does not, and the scope must load those Stories itself.
 */
type StoryScope = {
  readonly where: string;
  readonly params: readonly SQLiteBindValue[];
  readonly with?: string;
  readonly onAlbums?: boolean;
};

/**
 * The Track Stories `onAlbums` moves, each with its album: dated before the held album's release day. Read whole from the
 * album index, which is cheaper than a lookup per loaded Story.
 */
const EARLY_TRACK_SELECT = `select e.id, e.fan_id, e.story_type, t.album_id from releases t
  join releases al on al.item_type = 'a' and al.item_id = t.album_id
  join stories e on e.item_type = 't' and e.item_id = t.item_id
  where t.item_type = 't' and t.album_id is not null and e.story_date < al.release_date`;

const EARLY_TRACK_STORIES = `early_track_stories as materialized (${EARLY_TRACK_SELECT})`;

/** Where each early Track Story counts, by Story id: its album's key. */
async function earlyTrackAlbums(db: SQLiteDatabase): Promise<ReadonlyMap<number, ItemPair>> {
  const early = await db.getAllAsync<{ id: number; album_id: number }>(EARLY_TRACK_SELECT);
  return new Map(early.map((row) => [row.id, ['a', row.album_id] as const]));
}

const ALL_STORIES: StoryScope = { where: '1 = 1', params: [] };

type ItemPair = readonly [ItemType, number];

/** Every Story of the listed Releases; a view that judges whole Releases loads only its candidates this way. */
function storiesOfItems(items: readonly ItemPair[]): StoryScope {
  return {
    where: `(s.item_type, s.item_id) in (select json_extract(value, '$[0]'), json_extract(value, '$[1]') from json_each(?))`,
    params: [JSON.stringify(items)],
  };
}

/** A Release as one number for the per-Story lookups: Bandcamp ids sit far below 2^52, so the type rides in the low bit. */
function releaseKey(itemType: ItemType, itemId: number): number {
  return itemId * 2 + (itemType === 't' ? 1 : 0);
}

/** The stored feed tags as rows carry them: places left out, each norm name once. */
function rowTags(json: string): readonly FeedTag[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const seen = new Set<string>();
  const tags: FeedTag[] = [];
  for (const tag of parsed) {
    if (typeof tag !== 'object' || tag === null) continue;
    const { name, normName, isLoc } = tag as Record<string, unknown>;
    if (typeof name !== 'string' || typeof normName !== 'string' || isLoc === true || seen.has(normName)) continue;
    seen.add(normName);
    tags.push({ name, normName });
  }
  return tags;
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
    numTracks: row.num_tracks,
    isPreorder: row.is_preorder === 1,
    onReleaseDay: row.on_release_day === 1,
    pageName: row.page_name,
    artistCredit: row.artist_credit,
    tags: rowTags(row.tags),
  };
}

/**
 * The Stories in `scope`, newest action first, as the flat rows the feed rules read. Stories cross narrow and each
 * Release and Fan crosses once, however many Stories share it: the wide join repeated every Release column per Story.
 * Only the diagnostic listing supplies a limit; a view needs every selected Release's Stories before folding.
 */
async function loadStoryRows(db: SQLiteDatabase, scope: StoryScope, limit?: number): Promise<readonly FeedStoryRow[]> {
  const read = await db.getAllAsync<StoryRecord>(
    `${scope.with === undefined ? '' : `with ${scope.with}`}
     select s.id as story_id, s.story_type, s.story_date, s.review_text, s.fan_id, s.item_type, s.item_id
     from stories s
     where ${scope.where}
     order by s.story_date desc, s.id desc
     ${limit === undefined ? '' : 'limit ?'}`,
    limit === undefined ? [...scope.params] : [...scope.params, limit],
  );
  const moved = scope.onAlbums === true ? await earlyTrackAlbums(db) : new Map<number, ItemPair>();
  const stories = read.map((story) => {
    const album = moved.get(story.story_id);
    return album === undefined ? story : { ...story, item_type: album[0], item_id: album[1] };
  });
  const items = new Map<number, ItemPair>();
  const fanIds = new Set<number>();
  for (const story of stories) {
    const itemType = asItemType(story.item_type);
    if (itemType !== null) {
      const key = releaseKey(itemType, story.item_id);
      if (!items.has(key)) items.set(key, [itemType, story.item_id]);
    }
    if (story.fan_id !== null) fanIds.add(story.fan_id);
  }
  const releaseRows = await db.getAllAsync<ReleaseRecord>(
    `select r.item_type, r.item_id, r.band_id, r.title, r.url, r.art_id, r.release_date, r.label,
            r.featured_track_id, r.featured_track_title, r.featured_track_duration, r.num_streamable_tracks, r.num_tracks,
            r.is_preorder, ${ON_RELEASE_DAY} as on_release_day, p.name as page_name, r.artist_credit, r.tags
     from json_each(?) k
     join releases r on r.item_type = json_extract(k.value, '$[0]') and r.item_id = json_extract(k.value, '$[1]')
     join pages p on p.band_id = r.band_id`,
    [JSON.stringify([...items.values()])],
  );
  const fanRows = await db.getAllAsync<FanRecord>(
    'select fan_id, username, name, image_id from fans where fan_id in (select value from json_each(?))',
    [JSON.stringify([...fanIds])],
  );
  const releases = new Map<number, ReleasePart>();
  for (const row of releaseRows) {
    const part = toReleasePart(row);
    if (part !== null) releases.set(releaseKey(part.itemType, part.itemId), part);
  }
  const fans = new Map(fanRows.map((fan) => [fan.fan_id, fan]));

  const rows: FeedStoryRow[] = [];
  for (const story of stories) {
    const storyType = asStoryType(story.story_type);
    const itemType = asItemType(story.item_type);
    // No Release or Page held leaves the Story out, as the inner join did; a rebuild between the reads does the same.
    const release = itemType === null ? undefined : releases.get(releaseKey(itemType, story.item_id));
    if (storyType === null || release === undefined) continue;
    const storyDate = asDate(story.story_date);
    if (storyDate === null) continue;
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
      numTracks: release.numTracks,
      isPreorder: release.isPreorder,
      onReleaseDay: release.onReleaseDay,
      pageName: release.pageName,
      artistCredit: release.artistCredit,
      tags: release.tags,
    });
  }
  return rows;
}

/** A bounded diagnostic listing, newest action first, with Release, Page and Fan joined on; never an aggregate's input. */
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
  num_tracks: number | null;
  page_name: string;
  artist_credit: string | null;
  tags: string;
};

const UPCOMING_COLUMNS = `r.item_type, r.item_id, r.band_id, r.title, r.url, r.art_id, r.release_date, r.is_preorder, r.label,
  r.featured_track_id, r.featured_track_title, r.featured_track_duration, r.num_streamable_tracks, r.num_tracks,
  p.name as page_name, r.artist_credit, r.tags`;

function toUpcomingRow(row: UpcomingRecord): UpcomingReleaseRow | null {
  const itemType = asItemType(row.item_type);
  const releaseDate = asDate(row.release_date);
  if (itemType === null || releaseDate === null) return null;
  return {
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
    numTracks: row.num_tracks,
    pageName: row.page_name,
    artistCredit: row.artist_credit,
    tags: rowTags(row.tags),
  };
}

/** A purchase Story whose Fan is held: the only kind the rules count as a buyer. */
const NAMED_PURCHASES = `stories b join fans f on f.fan_id = b.fan_id where b.story_type = 'purchase'`;

/**
 * A named Fan bought the Release, or a Track of the album; an Upcoming album's Track is always bought before the album
 * is out.
 */
const BOUGHT_BY_NAMED_FAN = `exists (select 1 from ${NAMED_PURCHASES}
  and ((b.item_type = r.item_type and b.item_id = r.item_id)
    or (r.item_type = 'a' and b.item_type = 't' and b.item_id in (
      select t.item_id from releases t where t.item_type = 't' and t.album_id = r.item_id))))`;

/** The shelf's reach: the Release's Page is followed, or a Story reaches the Release or one of its Tracks (ADR-0017). */
export const REACHED_BY_FOLLOW_OR_STORY = `(exists (select 1 from follows f where f.band_id = r.band_id)
  or exists (select 1 from stories s where s.item_type = r.item_type and s.item_id = r.item_id)
  or (r.item_type = 'a' and exists (
    select 1 from releases t where t.item_type = 't' and t.album_id = r.item_id
      and exists (select 1 from stories s where s.item_type = 't' and s.item_id = t.item_id))))`;

/** A Track whose album is held: never Upcoming on its own, since its album is drawn. */
export const TRACK_OF_HELD_ALBUM = `(r.item_type = 't' and r.album_id is not null
  and exists (select 1 from releases al where al.item_type = 'a' and al.item_id = r.album_id))`;

/**
 * Releases dated ahead of today's GMT day, or out within the handoff and held before they came out, whose Page is
 * followed or which a Story reaches (ADR-0017), less the Tracks of held albums. Each half, and the ones a named Fan
 * bought, selects its own bounded Releases in one SQLite read, so neither can spend the others' capacity.
 */
export async function listUpcomingReleases(db: SQLiteDatabase, now: Date): Promise<readonly UpcomingReleaseRow[]> {
  const eligible = `select ${UPCOMING_COLUMNS}
    from releases r
    join pages p on p.band_id = r.band_id
    where ${REACHED_BY_FOLLOW_OR_STORY}
      and not ${TRACK_OF_HELD_ALBUM}`;
  const ahead = aheadFrom(now).toISOString();
  const rows = await db.getAllAsync<UpcomingRecord>(
    `with just_out as (
       ${eligible}
         and r.release_date >= ? and r.release_date < ? and ${HELD_BEFORE_OUT}
       order by r.release_date asc, r.item_type asc, r.item_id asc
       limit ?
     ), upcoming as (
       ${eligible}
         and r.release_date >= ?
       order by r.release_date asc, r.item_type asc, r.item_id asc
       limit ?
     ), bought as (
       ${eligible}
         and r.release_date >= ? and ${BOUGHT_BY_NAMED_FAN}
       order by r.release_date asc, r.item_type asc, r.item_id asc
       limit ?
     )
     select * from just_out union select * from upcoming union select * from bought
     order by release_date asc, item_type asc, item_id asc`,
    [handoffFloor(now).toISOString(), ahead, UPCOMING_MAX_RELEASES, ahead, UPCOMING_MAX_RELEASES, ahead, UPCOMING_MAX_RELEASES],
  );
  return rows.flatMap((row) => {
    const release = toUpcomingRow(row);
    return release === null ? [] : [release];
  });
}

/** Ceiling against a runaway fold, not a page size: a year of Drops from a few hundred Upcoming Releases sits well under it. */
export const DROPS_MAX = 2_000;

type DropRecord = UpcomingRecord & {
  day: string;
  tracks_out: number;
  drop_num_tracks: number | null;
  track_ids: string;
};

/**
 * Every Drop whose Release has a release date, newest day first: an undated pre-order waits for
 * its page, which dates it, and the row names that day. The total is the Drop's own, else the Release's. The fold
 * writes a Drop for any Upcoming Release it holds; only those the shelf's reach takes in are drawn.
 */
export async function listDrops(db: SQLiteDatabase): Promise<readonly DropRow[]> {
  const rows = await db.getAllAsync<DropRecord>(
    `select ${UPCOMING_COLUMNS}, d.day, d.num_streamable_tracks as tracks_out,
            coalesce(d.num_tracks, r.num_tracks) as drop_num_tracks, d.track_ids
     from drops d
     join releases r on r.item_type = d.item_type and r.item_id = d.item_id
     join pages p on p.band_id = r.band_id
     where r.release_date is not null
       and ${REACHED_BY_FOLLOW_OR_STORY}
       and not ${TRACK_OF_HELD_ALBUM}
     order by d.day desc, d.item_type asc, d.item_id asc
     limit ?`,
    [DROPS_MAX],
  );
  return rows.flatMap((row) => {
    const release = toUpcomingRow(row);
    if (release === null) return [];
    const newest = trackIds(row.track_ids).at(-1);
    return [
      {
        release,
        day: row.day,
        tracksOut: row.tracks_out,
        numTracks: row.drop_num_tracks,
        newestTrackId: newest ?? null,
      },
    ];
  });
}

export type OverviewView = {
  readonly updatedAt: string | null;
  /** The Pages this Fan's own Stories reach, the server's "All pages" number. */
  readonly pageCount: number;
  readonly followCount: number;
  readonly releaseCount: number;
  readonly storyCount: number;
};

export async function readOverview(db: SQLiteDatabase): Promise<OverviewView> {
  const counts = await db.getFirstAsync<{ pages: number; follows: number; releases: number; stories: number }>(
    `select
       (select count(distinct r.band_id) from stories s
          join releases r on r.item_type = s.item_type and r.item_id = s.item_id) as pages,
       (select count(*) from follows) as follows,
       (select count(*) from releases) as releases,
       (select count(*) from stories) as stories`,
  );
  return {
    updatedAt: await lastFetchedAt(db),
    pageCount: counts?.pages ?? 0,
    followCount: counts?.follows ?? 0,
    releaseCount: counts?.releases ?? 0,
    storyCount: counts?.stories ?? 0,
  };
}

/**
 * Every Story of each Release New releases could draw: those a new-release Story names, the shelf's and the Drops'
 * (`listed`), those a named Fan bought that have a release day, and the albums early Track
 * Stories count on, with those Stories, which `onAlbums` moves onto them.
 */
function newReleasesScope(listed: readonly ItemPair[]): StoryScope {
  const items = storiesOfItems(listed);
  return {
    where: `(s.item_type, s.item_id) in (select n.item_type, n.item_id from stories n where n.story_type = 'new_release')
      or ${items.where}
      or (s.item_type, s.item_id) in (select b.item_type, b.item_id from ${NAMED_PURCHASES}
        and exists (select 1 from releases r where r.item_type = b.item_type and r.item_id = b.item_id and r.release_date is not null))
      or s.id in (select id from early_track_stories)
      or (s.item_type = 'a' and s.item_id in (select e.album_id from early_track_stories e))`,
    params: items.params,
    with: EARLY_TRACK_STORIES,
    onAlbums: true,
  };
}

/**
 * The New releases view in one read: `/api/upcoming` split at today's GMT day, the new-release Feed Items (everything,
 * anchor sort) filed into weeks with their buyers, the Releases followed Fans bought, and the Drops.
 */
export async function readNewReleases(db: SQLiteDatabase, options: { readonly now: Date }): Promise<NewReleasesView> {
  const upcoming = await listUpcomingReleases(db, options.now);
  const drops = await listDrops(db);
  const listed = [...upcoming, ...drops.map((drop) => drop.release)].map((release): ItemPair => [release.itemType, release.itemId]);
  const stories = await loadStoryRows(db, newReleasesScope(listed));
  return newReleasesOf({ stories, upcoming, drops, now: options.now });
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
export async function readCurated(db: SQLiteDatabase, _options: { readonly now?: Date } = {}): Promise<CuratedFeed> {
  const candidates = await curatedCandidates(db);
  return buildCurated(candidates === null ? [] : await loadStoryRows(db, storiesOfItems(candidates)));
}

export type WishlistKey = { readonly itemType: ItemType; readonly itemId: string };

/**
 * Membership as Bandcamp's own wishlist last said. With keys, one answer per
 * key; without, every item held. `pending` is the wishlist exchange's to fill.
 */
export async function readWishlistState(db: SQLiteDatabase, keys?: readonly WishlistKey[]): Promise<WishlistState> {
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

/** Candidates the host rule sees per call; a store whose newest Stories all sit on custom domains past it answers null. */
const STAND_IN_CANDIDATES = 50;

/**
 * The newest Story's Release whose page is on a bandcamp.com host, or null: the stand-in a Release on a custom domain
 * reads its wishlist crumb off (ADR-0016 amendment 2026-09-28). SQL only narrows to URLs naming bandcamp.com; the host
 * rule is the session's own `onBandcampHost`, so the store and the session never disagree on a URL.
 */
export async function readNewestBandcampReleaseUrl(db: SQLiteDatabase): Promise<string | null> {
  const rows = await db.getAllAsync<{ url: string }>(
    `select r.url from stories s join releases r on r.item_type = s.item_type and r.item_id = s.item_id
     where r.url like '%bandcamp.com%'
     order by s.story_date desc, s.id desc limit ?`,
    [STAND_IN_CANDIDATES],
  );
  return rows.find((row) => onBandcampHost(row.url))?.url ?? null;
}

/**
 * The player's tracklist off the newest stored release page, or null when none
 * is held; the caller refetches once `expiresAt` has passed (ADR-0015).
 */
export async function readTracklist(db: SQLiteDatabase, itemType: ItemType, itemId: number): Promise<ReleaseTracks | null> {
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

export type ChainCounts = { readonly feedPages: number; readonly releasePagesFailed: number };

/**
 * What a gather chain's Tallies read back from the store: the feed pages held, which after a first walk are
 * the pages it took, and the release pages booked `failed` (a page's own 4xx) since the chain started.
 */
export async function readChainCounts(db: SQLiteDatabase, since: Date): Promise<ChainCounts> {
  const row = await db.getFirstAsync<{ feed_pages: number; release_pages_failed: number }>(
    `select (select count(*) from raw_documents where endpoint = ?) as feed_pages,
            (select count(*) from release_page_attempts where outcome = 'failed' and attempted_at >= ?) as release_pages_failed`,
    [FEED_UPDATES_ENDPOINT, since.toISOString()],
  );
  return { feedPages: row?.feed_pages ?? 0, releasePagesFailed: row?.release_pages_failed ?? 0 };
}

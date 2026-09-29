/**
 * Drops, written by the Projection only (task 0041, decisions 6 and 7; ADR-0017 amended 2026-09-29). A read of an
 * Upcoming Release, a `new_release` feed entry or a release page, that shows more Tracks playing than any read before
 * it writes a Drop, one per Release per GMT day; a Track page of a Track it let out may then date it. Each read is a Raw
 * Document folded in raw id order, which is the order the phone fetched them in, and every rule reads only what the
 * fold has reached, so a rebuild writes the same Drops on the same days (ADR-0004).
 */
import type { SQLiteDatabase } from 'expo-sqlite';

import { parseReleasePage, ReleasePagePayloadError } from '../domain/parseReleasePage';
import { storedTralbum } from '../domain/releasePage';
import { newlyOutTracks } from '../domain/tralbumTracks';
import type { ItemType, ParsedReleasePage } from '../domain/types';
import { aheadFrom } from '../domain/upcoming';
import { latestReleasePageDocument, type RawDocument } from './rawDocuments';

/** What set a Drop's day: the album page's `publish_date`, the `new_release` Story, the read, or a Track page. */
type DatedBy = 'published' | 'story' | 'read' | 'track';

type DropRecord = {
  readonly day: string;
  readonly num_streamable_tracks: number;
  readonly num_tracks: number | null;
  readonly track_ids: string;
  readonly read_at: string;
  readonly after_read_at: string | null;
  readonly track_at: string | null;
  readonly dated_by: DatedBy;
};

type HeldRelease = {
  readonly release_date: string | null;
  readonly is_preorder: number;
  readonly num_tracks: number | null;
  readonly feed_tracks_read_at: string | null;
  readonly page_tracks_read_at: string | null;
};

type ReleaseRef = { readonly itemType: ItemType; readonly itemId: number };

/** One read's count of the Tracks that play; `firstDay` is where a Drop on the Release's first read sits, looked up only then. */
type TrackRead = ReleaseRef & {
  readonly source: 'feed' | 'page';
  readonly tracksOut: number;
  readonly numTracks: number | null;
  readonly readAt: string;
  /** The Tracks this read shows playing that the page before it did not, in track order; a feed entry names none. */
  readonly newlyOut: readonly number[];
  readonly firstDay: () => Promise<{ readonly at: string; readonly datedBy: DatedBy } | null>;
};

const DROP_COLUMNS = 'day, num_streamable_tracks, num_tracks, track_ids, read_at, after_read_at, track_at, dated_by';

function gmtDay(instant: string): string {
  return new Date(instant).toISOString().slice(0, 10);
}

function later(a: string | null, b: string | null): string | null {
  if (a === null) return b;
  if (b === null) return a;
  return a > b ? a : b;
}

/** A Drop's `track_ids` column, the Tracks it let out in track order; anything else in it reads as none. */
export function trackIds(value: string): number[] {
  const parsed: unknown = JSON.parse(value);
  return Array.isArray(parsed) ? parsed.filter((id): id is number => typeof id === 'number') : [];
}

/**
 * Upcoming at that read: dated after the read's GMT day, or a pre-order no page has dated yet (task 0041, decision 1).
 * The Release's own row as the fold has it, this document's own writes included.
 */
function upcomingAt(release: HeldRelease, readAt: string): boolean {
  if (release.release_date === null) return release.is_preorder === 1;
  return release.release_date >= aheadFrom(new Date(readAt)).toISOString();
}

/** Two Drops on one day are one: the higher count, the later read's total, both windows, every Track (decision 6). */
function merged(held: DropRecord, incoming: DropRecord): DropRecord {
  const newer = incoming.read_at >= held.read_at ? incoming : held;
  const ids = trackIds(held.track_ids);
  for (const id of trackIds(incoming.track_ids)) if (!ids.includes(id)) ids.push(id);
  return {
    day: held.day,
    num_streamable_tracks: Math.max(held.num_streamable_tracks, incoming.num_streamable_tracks),
    num_tracks: newer.num_tracks ?? held.num_tracks ?? incoming.num_tracks,
    track_ids: JSON.stringify(ids),
    read_at: newer.read_at,
    after_read_at: held.after_read_at === null || incoming.after_read_at === null ? null : held.after_read_at < incoming.after_read_at ? held.after_read_at : incoming.after_read_at,
    track_at: later(held.track_at, incoming.track_at),
    dated_by: held.dated_by,
  };
}

async function writeDrop(db: SQLiteDatabase, release: ReleaseRef, drop: DropRecord): Promise<void> {
  const held = await db.getFirstAsync<DropRecord>(
    `select ${DROP_COLUMNS} from drops where item_type = ? and item_id = ? and day = ?`,
    [release.itemType, release.itemId, drop.day],
  );
  const row = held === null ? drop : merged(held, drop);
  await db.runAsync(
    `insert into drops (item_type, item_id, ${DROP_COLUMNS}) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     on conflict (item_type, item_id, day) do update set
       num_streamable_tracks = excluded.num_streamable_tracks, num_tracks = excluded.num_tracks,
       track_ids = excluded.track_ids, read_at = excluded.read_at, after_read_at = excluded.after_read_at,
       track_at = excluded.track_at, dated_by = excluded.dated_by`,
    [
      release.itemType,
      release.itemId,
      row.day,
      row.num_streamable_tracks,
      row.num_tracks,
      row.track_ids,
      row.read_at,
      row.after_read_at,
      row.track_at,
      row.dated_by,
    ],
  );
}

/** The newest count each source stated, which dates the next Drop's window and makes the page due (decision 8). */
async function recordRead(db: SQLiteDatabase, read: TrackRead): Promise<void> {
  const [out, at] = read.source === 'feed' ? ['feed_tracks_out', 'feed_tracks_read_at'] : ['page_tracks_out', 'page_tracks_read_at'];
  await db.runAsync(
    `update releases set ${out} = ?, ${at} = ? where item_type = ? and item_id = ? and (${at} is null or ${at} <= ?)`,
    [read.tracksOut, read.readAt, read.itemType, read.itemId, read.readAt],
  );
}

/**
 * A rise above the highest count seen writes a Drop (task 0041, decision 6): the first read of the Release, when a Track
 * plays, is dated by `firstDay`; any later rise, the first included when earlier reads showed none playing, by the read
 * that showed more until a Track page dates it (decision 7). A page that
 * shows no rise names the Tracks of the newest Drop a feed entry wrote without them.
 */
async function foldTrackRead(db: SQLiteDatabase, read: TrackRead): Promise<void> {
  const release = await db.getFirstAsync<HeldRelease>(
    `select release_date, is_preorder, num_tracks, feed_tracks_read_at, page_tracks_read_at
     from releases where item_type = ? and item_id = ?`,
    [read.itemType, read.itemId],
  );
  if (release === null || !upcomingAt(release, read.readAt)) return;
  const lastRead = later(release.feed_tracks_read_at, release.page_tracks_read_at);
  await recordRead(db, read);

  const held = await db.getFirstAsync<{ highest: number | null; newest: string | null }>(
    `select max(num_streamable_tracks) as highest,
       (select day from drops where item_type = ? and item_id = ? order by read_at desc, day desc limit 1) as newest
     from drops where item_type = ? and item_id = ?`,
    [read.itemType, read.itemId, read.itemType, read.itemId],
  );
  const highest = held?.highest ?? null;
  if (read.tracksOut < 1 || (highest !== null && read.tracksOut <= highest)) {
    if (read.newlyOut.length > 0 && held?.newest != null) {
      await db.runAsync(`update drops set track_ids = ? where item_type = ? and item_id = ? and day = ? and track_ids = '[]'`, [
        JSON.stringify(read.newlyOut),
        read.itemType,
        read.itemId,
        held.newest,
      ]);
    }
    return;
  }

  // Only a first sighting takes `firstDay`; a first rise after a read that showed none playing lies in that window.
  const first = highest === null && lastRead === null ? await read.firstDay() : null;
  await writeDrop(db, read, {
    day: gmtDay(first?.at ?? read.readAt),
    num_streamable_tracks: read.tracksOut,
    num_tracks: read.numTracks ?? release.num_tracks,
    track_ids: JSON.stringify(read.newlyOut),
    read_at: read.readAt,
    after_read_at: lastRead,
    track_at: null,
    dated_by: first?.datedBy ?? 'read',
  });
}

async function newReleaseStoryDate(db: SQLiteDatabase, release: ReleaseRef): Promise<string | null> {
  const row = await db.getFirstAsync<{ story_date: string }>(
    `select story_date from stories where story_type = 'new_release' and item_type = ? and item_id = ? limit 1`,
    [release.itemType, release.itemId],
  );
  return row?.story_date ?? null;
}

/** The `publish_date` of the newest release page the fold had reached before `beforeId`, or null. */
async function heldPublishedAt(db: SQLiteDatabase, release: ReleaseRef, beforeId: number): Promise<string | null> {
  const doc = await latestReleasePageDocument(db, release.itemType, release.itemId, beforeId);
  if (doc === null) return null;
  try {
    return parseReleasePage(doc.payload).publishedAt?.toISOString() ?? null;
  } catch (err) {
    if (err instanceof ReleasePagePayloadError) return null;
    throw err;
  }
}

/**
 * A `new_release` entry's count, the true one (task 0041); a Drop on the first read sits on the held page's publish date,
 * else the Story's.
 */
export async function foldFeedTrackRead(
  db: SQLiteDatabase,
  doc: RawDocument,
  release: ReleaseRef & { readonly tracksOut: number; readonly storyDate: Date },
): Promise<void> {
  await foldTrackRead(db, {
    itemType: release.itemType,
    itemId: release.itemId,
    source: 'feed',
    tracksOut: release.tracksOut,
    numTracks: null,
    readAt: doc.fetchedAt,
    newlyOut: [],
    async firstDay() {
      const published = await heldPublishedAt(db, release, doc.id);
      return published === null
        ? { at: release.storyDate.toISOString(), datedBy: 'story' }
        : { at: published, datedBy: 'published' };
    },
  });
}

/**
 * A release page's count; the Tracks it let out are those that play here and did not on the page before it. A Drop on
 * the Release's first read sits on this page's publish date, else the `new_release` Story's, else the read's own day.
 */
export async function foldPageTrackRead(db: SQLiteDatabase, doc: RawDocument, parsed: ParsedReleasePage): Promise<void> {
  if (parsed.numStreamableTracks === null) return;
  const before = await latestReleasePageDocument(db, parsed.itemType, parsed.itemId, doc.id);
  const newlyOut = newlyOutTracks(before === null ? null : storedTralbum(before.payload), storedTralbum(doc.payload));
  await foldTrackRead(db, {
    itemType: parsed.itemType,
    itemId: parsed.itemId,
    source: 'page',
    tracksOut: parsed.numStreamableTracks,
    numTracks: parsed.numTracks,
    readAt: doc.fetchedAt,
    newlyOut: newlyOut.map((track) => Number(track.trackId)),
    async firstDay() {
      if (parsed.publishedAt !== null) return { at: parsed.publishedAt.toISOString(), datedBy: 'published' };
      const story = await newReleaseStoryDate(db, parsed);
      return story === null ? null : { at: story, datedBy: 'story' };
    },
  });
}

/**
 * A Track page of a Track a later Drop let out dates that Drop by its `mod_date`, the newest of them, when the moment
 * lies after the read that showed fewer Tracks and no later than the read that showed more (task 0041, decision 7).
 * ceiling: that a `mod_date` inside the window is the day the Track came out is unproven (task 0041, open); the check
 * is the next Track of "chrysalis" against Bandcamp's email, and if it fails the read's own day is all that is left, or
 * a Track's own release moment should Bandcamp ever state one.
 */
export async function foldTrackPage(db: SQLiteDatabase, parsed: ParsedReleasePage): Promise<void> {
  if (parsed.itemType !== 't' || parsed.albumId === null || parsed.modifiedAt === null) return;
  const album: ReleaseRef = { itemType: 'a', itemId: parsed.albumId };
  const drop = await db.getFirstAsync<DropRecord>(
    `select ${DROP_COLUMNS} from drops d
     where d.item_type = 'a' and d.item_id = ? and d.dated_by in ('read', 'track')
       and exists (select 1 from json_each(d.track_ids) t where t.value = ?)
     order by d.read_at desc limit 1`,
    [album.itemId, parsed.itemId],
  );
  if (drop === null) return;
  const moment = parsed.modifiedAt.toISOString();
  const inWindow = moment <= drop.read_at && (drop.after_read_at === null || moment > drop.after_read_at);
  if (!inWindow || (drop.track_at !== null && moment <= drop.track_at)) return;

  const day = gmtDay(moment);
  if (day === drop.day) {
    await db.runAsync(`update drops set track_at = ?, dated_by = 'track' where item_type = ? and item_id = ? and day = ?`, [
      moment,
      album.itemType,
      album.itemId,
      day,
    ]);
    return;
  }
  // Moved onto a day that holds a Drop already, the two are one (decision 6).
  await db.runAsync('delete from drops where item_type = ? and item_id = ? and day = ?', [album.itemType, album.itemId, drop.day]);
  await writeDrop(db, album, { ...drop, day, track_at: moment, dated_by: 'track' });
}

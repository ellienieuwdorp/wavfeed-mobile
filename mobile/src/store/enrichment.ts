/**
 * Release-date enrichment's worklist on the device (ADR-0011, DESIGN.md section 3): the Releases a Story or
 * a wishlist item reaches whose public page has not yet given the Projection a `release_date`, and the attempts made
 * at each page, kept in `release_page_attempts` so a page that answered badly waits a day, or a week after three.
 * Upcoming Releases and the Track pages a Drop still owes share the turn's allowance fairly.
 */
import type { SQLiteDatabase } from 'expo-sqlite';

import type { ReleaseKey } from '../domain/endpoints';
import { storedTralbum } from '../domain/releasePage';
import { readTralbumTracks, type TralbumTrack } from '../domain/tralbumTracks';
import type { ItemType } from '../domain/types';
import { aheadFrom } from '../domain/upcoming';
import { DAY_MS } from '../lib/time';
import { TRACK_OF_HELD_ALBUM, REACHED_BY_FOLLOW_OR_STORY } from './queries';
import { latestReleasePageDocument } from './rawDocuments';

/** `dated` is the only outcome that clears the failure count: every other one left the Release undated. */
export type ReleasePageOutcome = 'dated' | 'undated' | 'gone' | 'unparsable' | 'refused' | 'failed';

/** A Release whose public page is due a read, and where it is. */
export type DueRelease = ReleaseKey & { readonly url: string };

export type UndatedRelease = DueRelease;

export type ReleaseDateCounts = { readonly dated: number; readonly undated: number };

export const RETRY_AFTER_MS = DAY_MS;
export const BACKOFF_AFTER_FAILURES = 3;
export const BACKOFF_MS = 7 * DAY_MS;

const REACHED = `(
  exists (select 1 from stories s where s.item_type = r.item_type and s.item_id = r.item_id)
  or exists (select 1 from wishlist_items w where w.item_type = r.item_type and w.item_id = r.item_id)
)`;

/** The attempt book lets a page be asked: never asked, or its wait (a day, a week after three failures) is over. */
const ATTEMPT_OVER = `(a.attempted_at is null or a.attempted_at <= case when a.failures >= ? then ? else ? end)`;

function asItemType(value: string): ItemType | null {
  return value === 'a' || value === 't' ? value : null;
}

/**
 * Pre-orders first, then Tracks whose known album is absent; within each, newest
 * Story first, then wishlist-only Releases by when they were wished for.
 */
export async function readUndatedReleases(
  db: SQLiteDatabase,
  limit: number,
  now: Date = new Date(),
): Promise<readonly UndatedRelease[]> {
  if (limit <= 0) return [];
  const retryBefore = new Date(now.getTime() - RETRY_AFTER_MS).toISOString();
  const backoffBefore = new Date(now.getTime() - BACKOFF_MS).toISOString();
  const rows = await db.getAllAsync<{ item_type: string; item_id: number; url: string }>(
    `select r.item_type, r.item_id, r.url,
       (select max(s.story_date) from stories s where s.item_type = r.item_type and s.item_id = r.item_id) as newest_story,
       (select w.added_at from wishlist_items w where w.item_type = r.item_type and w.item_id = r.item_id) as wished_at
     from releases r
     left join release_page_attempts a on a.item_type = r.item_type and a.item_id = r.item_id
     where r.release_date is null
       and ${REACHED}
       and ${ATTEMPT_OVER}
     order by r.is_preorder desc,
       (r.item_type = 't' and r.album_id is not null and nullif(trim(r.album_title), '') is not null
         and not exists (select 1 from releases al where al.item_type = 'a' and al.item_id = r.album_id)) desc,
       newest_story is null, newest_story desc, wished_at desc
     limit ?`,
    [BACKOFF_AFTER_FAILURES, backoffBefore, retryBefore, limit],
  );
  const releases: UndatedRelease[] = [];
  for (const row of rows) {
    const itemType = asItemType(row.item_type);
    if (itemType !== null && row.url !== '') releases.push({ itemType, itemId: row.item_id, url: row.url });
  }
  return releases;
}

/**
 * Upcoming Releases whose page is due once the attempt book allows: never read while Upcoming, the newest read a day
 * old, or the feed naming more Tracks playing than that read did (which skips a success's wait, never a failure's), the
 * feed's leads first. A page last read as a phone is due once more unless a failure's wait runs (migration 7's mark).
 * A Track whose album is held is never due; the album's page is.
 */
export async function readUpcomingDue(db: SQLiteDatabase, limit: number, now: Date = new Date(), only?: ReleaseKey): Promise<readonly DueRelease[]> {
  if (limit <= 0) return [];
  const retryBefore = new Date(now.getTime() - RETRY_AFTER_MS).toISOString();
  const attemptOver = [BACKOFF_AFTER_FAILURES, new Date(now.getTime() - BACKOFF_MS).toISOString(), retryBefore];
  const rows = await db.getAllAsync<{ item_type: string; item_id: number; url: string }>(
    `select item_type, item_id, url from (
       select r.item_type, r.item_id, r.url, r.release_date, r.page_tracks_read_at,
         (r.feed_tracks_out > coalesce(r.page_tracks_out, 0)
           and r.feed_tracks_read_at > coalesce(r.page_tracks_read_at, '')
           and (a.attempted_at is null or (a.failures = 0 and a.attempted_at < r.feed_tracks_read_at) or ${ATTEMPT_OVER})) as behind,
         ${ATTEMPT_OVER} and (r.page_tracks_read_at is null or r.page_tracks_read_at <= ?) as stale,
         (r.page_tracks_read_at is not null and a.asked_as_phone = 1 and a.failures = 0) as phone
       from releases r
       left join release_page_attempts a on a.item_type = r.item_type and a.item_id = r.item_id
       where r.release_date >= ?
         and ${REACHED_BY_FOLLOW_OR_STORY}
         and not ${TRACK_OF_HELD_ALBUM}
         ${only === undefined ? '' : 'and r.item_type = ? and r.item_id = ?'}
     )
     where behind or stale or phone
     order by behind desc, page_tracks_read_at is not null, page_tracks_read_at, release_date, item_type, item_id
     limit ?`,
    [...attemptOver, ...attemptOver, retryBefore, aheadFrom(now).toISOString(), ...(only === undefined ? [] : [only.itemType, only.itemId]), limit],
  );
  const releases: DueRelease[] = [];
  for (const row of rows) {
    const itemType = asItemType(row.item_type);
    if (itemType !== null && row.url !== '') releases.push({ itemType, itemId: row.item_id, url: row.url });
  }
  return releases;
}

/** A Track page a Drop still owes: the Track, its path on its Release's host, and that Release's page. */
export type OwedTrackPage = ReleaseKey & { readonly releaseUrl: string; readonly path: string };

/**
 * The Track pages a later Drop of a reached Upcoming Release still owes: a Track it let out that no read since the Drop
 * has asked, or whose failure's wait is over, at the newest album page's `title_link`. A Drop still dated by its read
 * owes once more a Track page that came back without a `mod_date` (read as a phone).
 */
export async function readOwedTrackPages(
  db: SQLiteDatabase,
  limit: number,
  now: Date = new Date(),
  albumId?: number,
): Promise<readonly OwedTrackPage[]> {
  if (limit <= 0) return [];
  const retryBefore = new Date(now.getTime() - RETRY_AFTER_MS).toISOString();
  const backoffBefore = new Date(now.getTime() - BACKOFF_MS).toISOString();
  const rows = await db.getAllAsync<{ album_id: number; url: string; track_id: number }>(
    `select d.item_id as album_id, r.url, t.value as track_id
     from drops d
     join releases r on r.item_type = d.item_type and r.item_id = d.item_id
     join json_each(d.track_ids) t
     left join release_page_attempts a on a.item_type = 't' and a.item_id = t.value
     where d.item_type = 'a' and d.dated_by in ('read', 'track')
       and r.release_date >= ?
       and ${REACHED_BY_FOLLOW_OR_STORY}
       and (a.attempted_at is null or a.attempted_at < d.read_at or (a.outcome = 'failed' and ${ATTEMPT_OVER})
         or (d.dated_by = 'read' and a.outcome in ('dated', 'undated') and a.asked_as_phone = 1))
       ${albumId === undefined ? '' : 'and d.item_id = ?'}
     order by d.read_at desc, d.item_id, t.key`,
    [aheadFrom(now).toISOString(), BACKOFF_AFTER_FAILURES, backoffBefore, retryBefore, ...(albumId === undefined ? [] : [albumId])],
  );
  const tracks = new Map<number, readonly TralbumTrack[]>();
  const owed = new Map<number, OwedTrackPage>();
  for (const row of rows) {
    if (owed.size >= limit) break;
    let named = tracks.get(row.album_id);
    if (named === undefined) {
      const page = await latestReleasePageDocument(db, 'a', row.album_id);
      named = page === null ? [] : readTralbumTracks(storedTralbum(page.payload));
      tracks.set(row.album_id, named);
    }
    const path = named.find((track) => track.trackId === String(row.track_id))?.path ?? null;
    if (path !== null && row.url !== '' && !owed.has(row.track_id)) {
      owed.set(row.track_id, { itemType: 't', itemId: row.track_id, releaseUrl: row.url, path });
    }
  }
  return [...owed.values()];
}

export async function markReleasePageAttempt(
  db: SQLiteDatabase,
  key: ReleaseKey,
  outcome: ReleasePageOutcome,
  at: Date = new Date(),
): Promise<void> {
  const failed = outcome === 'dated' ? 0 : 1;
  await db.runAsync(
    `insert into release_page_attempts (item_type, item_id, attempted_at, outcome, failures) values (?, ?, ?, ?, ?)
     on conflict (item_type, item_id) do update set
       attempted_at = excluded.attempted_at,
       outcome = excluded.outcome,
       asked_as_phone = 0,
       failures = case when excluded.failures = 0 then 0 else release_page_attempts.failures + 1 end`,
    [key.itemType, key.itemId, at.toISOString(), outcome, failed],
  );
}

/** Over the same reach as the worklist, whatever the attempts say. */
export async function readReleaseDateCounts(db: SQLiteDatabase): Promise<ReleaseDateCounts> {
  const row = await db.getFirstAsync<{ dated: number | null; undated: number | null }>(
    `select sum(r.release_date is not null) as dated, sum(r.release_date is null) as undated
     from releases r where ${REACHED}`,
  );
  return { dated: row?.dated ?? 0, undated: row?.undated ?? 0 };
}

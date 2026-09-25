/**
 * Release-date enrichment's worklist on the device (ADR-0011, DESIGN.md section 3, task 0036): the Releases a Story or
 * a wishlist item reaches whose public page has not yet given the Projection a `release_date`, and the attempts made
 * at each page, kept in `release_page_attempts` so a page that answered badly waits a day, or a week after three.
 */
import type { SQLiteDatabase } from 'expo-sqlite';

import type { ReleaseKey } from '../domain/endpoints';
import type { ItemType } from '../domain/types';

/** `dated` is the only outcome that clears the failure count: every other one left the Release undated. */
export type ReleasePageOutcome = 'dated' | 'undated' | 'gone' | 'unparsable' | 'refused' | 'failed';

export type UndatedRelease = ReleaseKey & { readonly url: string };

export type ReleaseDateCounts = { readonly dated: number; readonly undated: number };

const DAY_MS = 24 * 60 * 60 * 1000;
export const RETRY_AFTER_MS = DAY_MS;
export const BACKOFF_AFTER_FAILURES = 3;
export const BACKOFF_MS = 7 * DAY_MS;

const REACHED = `(
  exists (select 1 from stories s where s.item_type = r.item_type and s.item_id = r.item_id)
  or exists (select 1 from wishlist_items w where w.item_type = r.item_type and w.item_id = r.item_id)
)`;

function asItemType(value: string): ItemType | null {
  return value === 'a' || value === 't' ? value : null;
}

/** Newest Story first, then wishlist-only Releases by when they were wished for. */
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
       and (a.attempted_at is null or a.attempted_at <= case when a.failures >= ? then ? else ? end)
     order by newest_story is null, newest_story desc, wished_at desc
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

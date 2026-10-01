/**
 * The Tally outbox over the phone's store (task 0038, ADR-0021): the sharing row in `kv` that holds the yes and the
 * Install id together, the `tally_outbox` table of migration 4, and the send cycle's store side. Every write checks
 * the sharing row in the same statement, so nothing is queued while sharing is off, not even a drop count. Rows go out
 * oldest first in batches stamped with an id that a retry reuses, and the caps drop rows into a counter that
 * `tallies_dropped` reports. Time, ids and randomness are arguments.
 */
import type { SQLiteDatabase } from 'expo-sqlite';

import { DEMO_FAN_ID } from '@/demo/fan';
import { DAY_MS } from '@/lib/time';
import { foldLockFree, withFoldLock } from '@/store/foldLock';
import { IDENTITY_KEY, readKv } from '@/store/kv';
import { BUSY_TIMEOUT_MS } from '@/store/migrations';

import { WIRE, type Tally } from './catalogue';
import type { ErrorReport } from './errorReport';
import { countBucket, type Sharing } from './tally';
import { tallyWire, type OutboxRow, type TallyAt } from './wire';

export const SHARING_KEY = 'tally_sharing';
export const DROPPED_KEY = 'tally_dropped';
/** Set while the app is in the foreground with sharing on (src/tally/lifecycle.ts); part of the sharing state. */
export const FOREGROUND_KEY = 'tally_foreground';

/** ceiling: 2,000 Tallies and 30 days queued offline, oldest dropped first; raise with the Worker's 31-day clock window. */
export const MAX_TALLY_ROWS = 2_000;
export const MAX_AGE_MS = 30 * DAY_MS;
/** ceiling: the first 50 Error Reports held and 10 written a launch, whatever the fault; a per-fingerprint cap is next. */
export const MAX_ERROR_ROWS = 50;
export const MAX_ERRORS_PER_LAUNCH = 10;
/** ceiling: 60,000 bytes of rows a batch, under the Worker's 64 KB with room for the envelope; gzip once Hermes can. */
export const BATCH_BYTES = 60_000;

/**
 * A SQL condition true only while the yes is held and the store's Fan is not the Demo (task 0044 decision 1), so a
 * write that carries it does nothing after an off or while someone is looking around.
 */
export const SHARING_ON = `exists (select 1 from kv where key = '${SHARING_KEY}' and json_extract(value, '$.on') = 1)
  and not exists (select 1 from kv where key = '${IDENTITY_KEY}' and json_extract(value, '$.fanId') = ${DEMO_FAN_ID})`;

export async function readSharing(db: SQLiteDatabase): Promise<Sharing | null> {
  const sharing = await readKv<Sharing>(db, SHARING_KEY);
  return sharing?.on === true ? sharing : null;
}

/** A yes already held keeps its Install id, even against a second press in flight; a new yes stores the minted id. */
export async function turnSharingOn(db: SQLiteDatabase, install: string, now: number): Promise<Sharing> {
  if (!WIRE.uuidPattern.test(install)) throw new Error('an Install id is a UUID');
  const sharing: Sharing = { on: true, install, since: now };
  await db.runAsync(
    `insert into kv (key, value) values (?1, ?2)
     on conflict (key) do update set value = excluded.value where json_extract(kv.value, '$.on') is not 1`,
    [SHARING_KEY, JSON.stringify(sharing)],
  );
  return (await readSharing(db)) ?? sharing;
}

/**
 * The yes, the Install id, the drop counter, the foreground marker and every queued row go together; the dropped Sharing
 * is returned, and a write that did not land rejects. It waits until no fold holds the write lock, since a replay holds
 * it past the busy timeout, then writes in its own exclusive transaction, which no gather write on the main connection
 * can join, counted with the folds' so an Error Report waits in memory meanwhile (review SEC-2, src/store/foldLock.ts).
 */
export async function turnSharingOff(db: SQLiteDatabase): Promise<Sharing | null> {
  await foldLockFree();
  let held: string | undefined;
  await withFoldLock(db, async (txn) => {
    await txn.execAsync(`pragma busy_timeout = ${BUSY_TIMEOUT_MS}`);
    // A write first, so the deferred transaction waits on the busy timeout instead of failing on a stale read.
    held = (await txn.getFirstAsync<{ value: string }>('delete from kv where key = ? returning value', [SHARING_KEY]))?.value;
    await txn.execAsync(`delete from kv where key in ('${DROPPED_KEY}', '${FOREGROUND_KEY}'); delete from tally_outbox;`);
  });
  return heldYes(held);
}

/** The dropped value read after the commit; a malformed one counts as no yes, since the off has already landed. */
function heldYes(value: string | undefined): Sharing | null {
  if (value === undefined) return null;
  try {
    const sharing = JSON.parse(value) as Sharing | null;
    return sharing?.on === true ? sharing : null;
  } catch {
    return null;
  }
}

export type DropReason = 'full' | 'old' | 'refused';
export type Dropped = Readonly<Record<DropReason, number>>;

const BUMP = `
  insert into kv (key, value) select '${DROPPED_KEY}', json_object(?1, ?2) where ${SHARING_ON}
  on conflict (key) do update set value = json_set(value, '$.' || ?1, coalesce(json_extract(value, '$.' || ?1), 0) + ?2)`;

async function bump(db: SQLiteDatabase, reason: DropReason, n: number): Promise<void> {
  if (n > 0) await db.runAsync(BUMP, [reason, n]);
}

function dropped(value: string | undefined): Dropped {
  const held = value === undefined ? {} : (JSON.parse(value) as Partial<Dropped>);
  return { full: held.full ?? 0, old: held.old ?? 0, refused: held.refused ?? 0 };
}

export async function readDropped(db: SQLiteDatabase): Promise<Dropped> {
  const row = await db.getFirstAsync<{ value: string }>('select value from kv where key = ?', [DROPPED_KEY]);
  return dropped(row?.value);
}

/** Queues a Tally unless sharing is off; the oldest Tallies past the cap are dropped and counted. */
export async function enqueueTally(db: SQLiteDatabase, tally: Tally, at: TallyAt): Promise<boolean> {
  const { changes } = await db.runAsync(
    `insert into tally_outbox (kind, body, created_at) select 'tally', ?, ? where ${SHARING_ON}`,
    [JSON.stringify(tallyWire(tally, at)), at.t],
  );
  if (changes === 0) return false;
  const over = await db.runAsync(
    `delete from tally_outbox where kind = 'tally' and seq <= (
       select seq from tally_outbox where kind = 'tally' order by seq desc limit 1 offset ?)`,
    [MAX_TALLY_ROWS],
  );
  await bump(db, 'full', over.changes);
  return true;
}

/** Rows waiting, stamped or not; the sender flushes early at 20. */
export async function countQueued(db: SQLiteDatabase): Promise<number> {
  return (await db.getFirstAsync<{ n: number }>('select count(*) as n from tally_outbox'))?.n ?? 0;
}

/** Error Reports written so far in this launch, held by the caller for the life of the process. */
export type Launch = { errorsWritten: number };

/** Synchronous, for a handler the process may not outlive; never throws. Refused past either cap, and counted. */
export function enqueueErrorSync(db: SQLiteDatabase, launch: Launch, report: ErrorReport): boolean {
  try {
    const room = launch.errorsWritten < MAX_ERRORS_PER_LAUNCH;
    const { changes } = room
      ? db.runSync(
          `insert into tally_outbox (kind, body, created_at) select 'error', ?, ? where ${SHARING_ON}
             and (select count(*) from tally_outbox where kind = 'error') < ?`,
          [JSON.stringify(report), report.t, MAX_ERROR_ROWS],
        )
      : { changes: 0 };
    if (changes === 1) {
      launch.errorsWritten += 1;
      return true;
    }
    db.runSync(BUMP, ['full', 1]);
  } catch {
    // A report that cannot be written is lost; the handler that called must still reach the previous one.
  }
  return false;
}

export type OutboxBatch = { readonly batch: string; readonly rows: readonly OutboxRow[] };

const STAMP = `
  update tally_outbox set batch = ?1 where seq in (
    select seq from (
      select seq,
        row_number() over (order by seq) as n,
        sum(kind = 'error') over (order by seq) as errors,
        sum(length(cast(body as blob))) over (order by seq) as bytes
      from tally_outbox where batch is null
    ) where n = 1 or (n <= ?2 and errors <= ?3 and bytes <= ?4)
  )`;

/**
 * The batch to send: rows already stamped by a send that got no answer go again under the same id, so the Worker's
 * guard makes the retry idempotent; otherwise the oldest rows are stamped with `newId()`, as many as the Worker takes.
 * Rows past the age cap are dropped first. Null when nothing is queued.
 */
export async function takeBatch(db: SQLiteDatabase, newId: () => string, now: number): Promise<OutboxBatch | null> {
  const old = await db.runAsync('delete from tally_outbox where created_at < ?', [now - MAX_AGE_MS]);
  await bump(db, 'old', old.changes);
  const held = await db.getFirstAsync<{ batch: string }>(
    'select batch from tally_outbox where batch is not null order by seq limit 1',
  );
  let batch = held?.batch ?? null;
  if (batch === null) {
    batch = newId();
    const { changes } = await db.runAsync(STAMP, [batch, WIRE.maxTallies, WIRE.maxErrors, BATCH_BYTES]);
    if (changes === 0) return null;
  }
  const rows = await db.getAllAsync<OutboxRow>(
    'select seq, kind, body from tally_outbox where batch = ? order by seq',
    [batch],
  );
  return { batch, rows };
}

export type Verdict = 'sent' | 'refused' | 'retry';

/** 2xx was stored; 408, 429, 5xx and no answer are worth another try; any other 4xx never will be. */
export function verdict(answer: number | 'network'): Verdict {
  if (answer === 'network') return 'retry';
  if (answer >= 200 && answer < 300) return 'sent';
  if (answer >= 400 && answer < 500 && answer !== 408 && answer !== 429) return 'refused';
  return 'retry';
}

export async function settleBatch(db: SQLiteDatabase, batch: string, outcome: Verdict): Promise<void> {
  if (outcome === 'retry') return;
  const { changes } = await db.runAsync('delete from tally_outbox where batch = ?', [batch]);
  if (outcome === 'refused') await bump(db, 'refused', changes);
}

const BACKOFF_BASE_MS = 5_000;
const BACKOFF_MAX_MS = 10 * 60 * 1000;
const RETRY_AFTER_MAX_MS = 60 * 60 * 1000;

/** Full jitter up to `min(10 min, 5 s × 2^attempt)`; a `Retry-After` is a floor, and nothing waits past an hour. */
export function backoffMs(attempt: number, random: () => number, retryAfter = 0): number {
  const ceiling = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** attempt);
  return Math.min(RETRY_AFTER_MAX_MS, Math.max(retryAfter, random() * ceiling));
}

/** The Worker sends `Retry-After` in seconds; anything else reads as none. */
export function retryAfterMs(header: string | null): number {
  return header !== null && /^\d+$/.test(header.trim()) ? Number(header.trim()) * 1000 : 0;
}

/** After a flush: one `tallies_dropped` per reason with drops. The counter is read and cleared in one statement. */
export async function enqueueDropped(db: SQLiteDatabase, at: TallyAt): Promise<number> {
  const row = await db.getFirstAsync<{ value: string }>('delete from kv where key = ? returning value', [DROPPED_KEY]);
  const counts = dropped(row?.value);
  let queued = 0;
  for (const reason of ['full', 'old', 'refused'] as const) {
    if (counts[reason] === 0) continue;
    const tally: Tally = { name: 'tallies_dropped', props: { reason, dropped: countBucket(counts[reason]) } };
    if (await enqueueTally(db, tally, at)) queued += 1;
  }
  return queued;
}

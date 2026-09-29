/// <reference types="node" />
/**
 * The outbox (task 0038, ADR-0021) on the real migrations over `node:sqlite`: nothing queued without a yes, the yes
 * and the Install id gone with opt-out and with "Remove everything gathered", the caps and their drop counts, and a
 * send cycle against a fake ingest Worker that stores each batch id once.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, test } from 'node:test';
import type { SQLiteDatabase } from 'expo-sqlite';

import { openTestStore } from '../../test/nodeDb';
import { DEMO_FAN_ID } from '../demo/fan';
import { IDENTITY_KEY, writeKv } from '../store/kv';
import { emptyStore } from '../store/schema';
import { WIRE, type Tally } from './catalogue';
import { buildErrorReport, type ErrorReport } from './errorReport';
import {
  backoffMs,
  enqueueDropped,
  enqueueErrorSync,
  enqueueTally,
  MAX_AGE_MS,
  readDropped,
  readSharing,
  retryAfterMs,
  settleBatch,
  takeBatch,
  turnSharingOff,
  turnSharingOn,
  verdict,
  type Launch,
} from './outbox';
import { batchBody, type BatchBody, type OutboxRow } from './wire';

const NOW = Date.UTC(2026, 8, 29, 12, 0, 0);
const INSTALL = '3b9f0c52-8a0e-4c2f-9a41-6f1d2b7e9c10';
const OPENED: Tally = { name: 'app_opened', props: { launch: 'cold' } };
const CTX = { schema: 1, version: '1.0.0', build: '37', update: 'embedded', env: 'production', platform: 'ios', os: 26 } as const;

let db: SQLiteDatabase;
let ids: number;
const newId = (): string => `00000000-0000-4000-8000-${String(++ids).padStart(12, '0')}`;
const at = (t: number) => ({ t, signedIn: true, walkDone: false });

async function rows(kind?: 'tally' | 'error'): Promise<number> {
  const sql = `select count(*) as n from tally_outbox${kind ? ` where kind = '${kind}'` : ''}`;
  return (await db.getFirstAsync<{ n: number }>(sql))?.n ?? 0;
}

async function queue(count: number, from = NOW): Promise<void> {
  for (let i = 0; i < count; i += 1) await enqueueTally(db, OPENED, at(from + i));
}

function report(t: number, frames = ''): ErrorReport {
  const error = new TypeError('undefined is not a function');
  error.stack = frames;
  return buildErrorReport(error, { t, source: 'global', fatal: true, screen: 'feed' });
}

beforeEach(async () => {
  ({ db } = await openTestStore());
  ids = 0;
});

describe('sharing', () => {
  test('with no yes nothing is queued, not an Error Report and not a drop count', async () => {
    assert.equal(await enqueueTally(db, OPENED, at(NOW)), false);
    const launch: Launch = { errorsWritten: 10 };
    assert.equal(enqueueErrorSync(db, launch, report(NOW)), false, 'past the launch cap');
    assert.equal(enqueueErrorSync(db, { errorsWritten: 0 }, report(NOW)), false);
    assert.equal(await rows(), 0);
    assert.equal((await db.getFirstAsync<{ n: number }>("select count(*) as n from kv where key like 'tally%'"))?.n, 0);
    assert.equal(await takeBatch(db, newId, NOW), null);
  });

  test('turning off drops the queue, the counts and the Install id, and a new yes mints a new id', async () => {
    await turnSharingOn(db, INSTALL, NOW);
    assert.equal((await turnSharingOn(db, newId(), NOW)).install, INSTALL, 'a yes already held keeps its id');
    await queue(3);
    await settleBatch(db, (await takeBatch(db, newId, NOW))?.batch ?? '', 'refused');
    assert.ok((await readDropped(db)).refused > 0);

    assert.equal((await turnSharingOff(db))?.install, INSTALL);
    assert.equal(await readSharing(db), null);
    assert.equal(await rows(), 0);
    assert.deepEqual(await readDropped(db), { full: 0, old: 0, refused: 0 });
    const again = await turnSharingOn(db, 'd4e5f6a7-0000-4000-8000-000000000001', NOW + 1);
    assert.notEqual(again.install, INSTALL);
  });

  test('two presses of yes in flight keep one Install id, and an id that is not a UUID is refused', async () => {
    const [a, b] = await Promise.all([turnSharingOn(db, INSTALL, NOW), turnSharingOn(db, newId(), NOW)]);
    assert.equal(a.install, b.install);
    assert.equal((await readSharing(db))?.install, a.install);
    await turnSharingOff(db);
    await assert.rejects(turnSharingOn(db, 'abc', NOW));
    assert.equal(await readSharing(db), null);
  });
});

describe('"Remove everything gathered"', () => {
  test('deleting the store file with its -wal and -shm leaves sharing off and the outbox empty', async (t) => {
    const dir = mkdtempSync(join(tmpdir(), 'wavfeed-tally-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const file = join(dir, 'wavfeed.db');
    const first = await openTestStore(file);
    await turnSharingOn(first.db, INSTALL, NOW);
    await enqueueTally(first.db, OPENED, at(NOW));
    first.close();
    for (const suffix of ['', '-wal', '-shm']) rmSync(`${file}${suffix}`, { force: true });

    const fresh = await openTestStore(file);
    assert.equal(await readSharing(fresh.db), null);
    assert.equal((await fresh.db.getFirstAsync<{ n: number }>('select count(*) as n from tally_outbox'))?.n, 0);
    fresh.close();
  });

  test('the fallback that empties every table does the same', async () => {
    await turnSharingOn(db, INSTALL, NOW);
    await queue(5);
    await emptyStore(db);
    assert.equal(await readSharing(db), null);
    assert.equal(await rows(), 0);
  });
});

describe('caps', () => {
  beforeEach(() => turnSharingOn(db, INSTALL, NOW));

  test('2,010 Tallies leave the newest 2,000 and count 10 dropped as full', async () => {
    await queue(2_010);
    assert.equal(await rows('tally'), 2_000);
    const oldest = await db.getFirstAsync<{ t: number }>('select min(created_at) as t from tally_outbox');
    assert.equal(oldest?.t, NOW + 10);
    assert.deepEqual(await readDropped(db), { full: 10, old: 0, refused: 0 });
  });

  test('Error Reports: ten a launch, the first fifty kept, every refusal counted', async () => {
    const first: Launch = { errorsWritten: 0 };
    const written = Array.from({ length: 11 }, (_, i) => enqueueErrorSync(db, first, report(NOW + i)));
    assert.deepEqual(written.filter(Boolean).length, 10);
    assert.equal(written[10], false, 'the eleventh in a launch');
    for (let launch = 1; launch < 6; launch += 1) {
      const next: Launch = { errorsWritten: 0 };
      for (let i = 0; i < 10; i += 1) enqueueErrorSync(db, next, report(NOW + launch * 100 + i));
    }
    assert.equal(await rows('error'), 50);
    const newest = await db.getFirstAsync<{ t: number }>("select max(created_at) as t from tally_outbox where kind = 'error'");
    assert.equal(newest?.t, NOW + 409, 'the sixth launch wrote nothing');
    assert.equal((await readDropped(db)).full, 11);
  });

  test('an Error Report that cannot be written is lost without a throw', async () => {
    const { db: closing, close } = await openTestStore();
    await turnSharingOn(closing, INSTALL, NOW);
    close();
    assert.equal(enqueueErrorSync(closing, { errorsWritten: 0 }, report(NOW)), false);
  });

  test('rows older than 30 days are dropped before a send and counted as old', async () => {
    await queue(3, NOW - MAX_AGE_MS - 10);
    await queue(2);
    const batch = await takeBatch(db, newId, NOW);
    assert.equal(batch?.rows.length, 2);
    assert.equal((await readDropped(db)).old, 3);
  });

  test('after a flush the drops go out as one tallies_dropped per reason and the counter starts again', async () => {
    await queue(2_003);
    await queue(1, NOW - MAX_AGE_MS - 10);
    await takeBatch(db, newId, NOW);
    await db.runAsync('delete from tally_outbox');
    assert.equal(await enqueueDropped(db, at(NOW)), 2);
    const bodies = await db.getAllAsync<{ body: string }>('select body from tally_outbox order by seq');
    assert.deepEqual(bodies.map((row) => JSON.parse(row.body)), [
      [NOW, 'tallies_dropped', 1, { reason: 'full', dropped: '2 to 5' }],
      [NOW, 'tallies_dropped', 1, { reason: 'old', dropped: '1' }],
    ]);
    assert.deepEqual(await readDropped(db), { full: 0, old: 0, refused: 0 });
  });
});

/** The ingest Worker's batch guard and verdicts, reduced to a map of stored batch ids and their items. */
function fakeWorker() {
  const stored = new Map<string, BatchBody>();
  return {
    stored,
    post(body: BatchBody): { status: number; duplicate: boolean } {
      const text = JSON.stringify(body);
      if (new TextEncoder().encode(text).length > WIRE.maxBytes) return { status: 413, duplicate: false };
      if (body.tallies.length > WIRE.maxTallies || body.errors.length > WIRE.maxErrors) return { status: 400, duplicate: false };
      if (stored.has(body.batch)) return { status: 200, duplicate: true };
      stored.set(body.batch, JSON.parse(text) as BatchBody);
      return { status: 200, duplicate: false };
    },
  };
}

async function send(worker: ReturnType<typeof fakeWorker>, loseAnswer = false): Promise<readonly OutboxRow[] | null> {
  const taken = await takeBatch(db, newId, NOW);
  if (taken === null) return null;
  const body = batchBody({ key: 'wf_prod_x', install: INSTALL, batch: taken.batch, sentAt: NOW, ctx: CTX }, taken.rows);
  const answer = worker.post(body);
  await settleBatch(db, taken.batch, verdict(loseAnswer ? 'network' : answer.status));
  return taken.rows;
}

describe('sending', () => {
  beforeEach(() => turnSharingOn(db, INSTALL, NOW));

  test('250 Tallies go out as 100, 100 and 50, oldest first', async () => {
    await queue(250);
    const worker = fakeWorker();
    const sizes: number[] = [];
    const seqs: number[] = [];
    for (let sent = await send(worker); sent !== null; sent = await send(worker)) {
      sizes.push(sent.length);
      seqs.push(...sent.map((row) => row.seq));
    }
    assert.deepEqual(sizes, [100, 100, 50]);
    assert.deepEqual(seqs, [...seqs].sort((a, b) => a - b));
    assert.equal(await rows(), 0);
  });

  test('a batch whose answer was lost goes again under the same id, and each item is stored once', async () => {
    await queue(30);
    const worker = fakeWorker();
    const lost = await send(worker, true);
    assert.equal(worker.stored.size, 1);
    const [firstId] = worker.stored.keys();
    const taken = await takeBatch(db, newId, NOW);
    assert.equal(taken?.batch, firstId);
    assert.deepEqual(taken?.rows, lost);
    await queue(5, NOW + 100);
    assert.equal((await send(worker))?.length, 30, 'rows queued since stay out of the retried batch');
    assert.equal(worker.stored.size, 1);
    assert.equal(worker.stored.get(firstId ?? '')?.tallies.length, 30);
    assert.equal((await send(worker))?.length, 5);
    assert.equal(await rows(), 0);
  });

  test('batches stay inside the Worker limits however large the Error Reports', async () => {
    const frame = (i: number) => `    at ${'f'.repeat(60)} (address at ${'m'.repeat(60)}.hbc:1:${100000 + i})`;
    const frames = Array.from({ length: 50 }, (_, i) => frame(i)).join('\n');
    // Thirty small reports meet the 20-per-batch rule first, twenty large ones the byte budget.
    for (let launch = 0; launch < 5; launch += 1) {
      const current: Launch = { errorsWritten: 0 };
      for (let i = 0; i < 10; i += 1) enqueueErrorSync(db, current, report(NOW + launch * 10 + i, launch < 3 ? '' : frames));
    }
    await queue(150);
    const worker = fakeWorker();
    const statuses: number[] = [];
    for (;;) {
      const taken = await takeBatch(db, newId, NOW);
      if (taken === null) break;
      const body = batchBody({ key: 'k', install: INSTALL, batch: taken.batch, sentAt: NOW, ctx: CTX }, taken.rows);
      const { status } = worker.post(body);
      statuses.push(status);
      await settleBatch(db, taken.batch, verdict(status));
    }
    assert.ok(statuses.every((status) => status === 200), statuses.join(', '));
    const stored = [...worker.stored.values()];
    assert.equal(stored.reduce((n, body) => n + body.errors.length, 0), 50);
    assert.equal(stored.reduce((n, body) => n + body.tallies.length, 0), 150);
  });

  test('a refused batch is deleted and counted; a batch worth retrying stays stamped', async () => {
    await queue(4);
    const taken = await takeBatch(db, newId, NOW);
    await settleBatch(db, taken?.batch ?? '', verdict(503));
    assert.equal(await rows(), 4);
    await settleBatch(db, taken?.batch ?? '', verdict(403));
    assert.equal(await rows(), 0);
    assert.equal((await readDropped(db)).refused, 4);
  });
});

describe('verdicts and backoff', () => {
  test('2xx is sent, 408, 429, 5xx and no answer retry, any other 4xx is refused', () => {
    const cases: [number | 'network', string][] = [
      [200, 'sent'], [204, 'sent'], [400, 'refused'], [403, 'refused'], [413, 'refused'], [408, 'retry'],
      [429, 'retry'], [500, 'retry'], [503, 'retry'], ['network', 'retry'],
    ];
    for (const [answer, expected] of cases) assert.equal(verdict(answer), expected, String(answer));
  });

  test('full jitter doubles from five seconds to a ten minute cap, and Retry-After is a floor up to an hour', () => {
    const top = () => 1;
    assert.equal(backoffMs(0, top), 5_000);
    assert.equal(backoffMs(6, top), 320_000);
    assert.equal(backoffMs(7, top), 600_000, 'the cap arrives at the seventh retry');
    assert.equal(backoffMs(30, top), 600_000);
    assert.equal(backoffMs(3, () => 0), 0);
    assert.equal(backoffMs(0, () => 0, retryAfterMs('60')), 60_000);
    assert.equal(backoffMs(0, top, retryAfterMs('3600')), 3_600_000);
    assert.equal(backoffMs(0, top, retryAfterMs('7200')), 3_600_000, 'no longer than an hour');
    assert.equal(retryAfterMs('Wed, 30 Sep 2026 12:00:00 GMT'), 0);
    assert.equal(retryAfterMs(null), 0);
  });
});

describe('the Demo', () => {
  test('queues nothing while the store holds the Demo Fan, even with a yes held (task 0044 decision 1)', async () => {
    await turnSharingOn(db, INSTALL, NOW);
    await writeKv(db, IDENTITY_KEY, { fanId: DEMO_FAN_ID, username: '', name: null, avatarUrl: null });
    assert.equal(await enqueueTally(db, OPENED, at(NOW)), false);
    assert.equal(enqueueErrorSync(db, { errorsWritten: 0 }, report(NOW)), false);
    assert.equal(await enqueueDropped(db, at(NOW)), 0);
    assert.equal(await rows(), 0);
    assert.equal((await db.getFirstAsync<{ n: number }>(`select count(*) as n from kv where key = 'tally_dropped'`))?.n, 0);

    await writeKv(db, IDENTITY_KEY, { fanId: 1_234, username: 'dj_okonkwo', name: null, avatarUrl: null });
    assert.equal(await enqueueTally(db, OPENED, at(NOW)), true, 'a sign-in that replaced the Demo queues again');
    assert.equal(await rows(), 1);
  });
});

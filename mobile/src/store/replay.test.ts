/// <reference types="node" />
/**
 * The fold's quarantine and the launch replay's resume (review findings ARCH-M1, ARCH-1 and ARCH-13) on the real
 * store: a document whose fold throws is rolled back, recorded, reported once and passed, and a rebuild retries it,
 * while a store failure fails the fold; a replay counts its progress and, cut short, resumes from the cursors without
 * emptying the tables again; a Projection newer than the code stays.
 */
import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import type { SQLiteDatabase } from 'expo-sqlite';

import { feedPayload, purchaseAt } from '../../test/fixtures';
import { openTestStore } from '../../test/nodeDb';
import { FEED_UPDATES_ENDPOINT } from '../domain/endpoints';
import type { ErrorReport } from '../tally/errorReport';
import { errorReports } from '../tally/errors';
import { turnSharingOn } from '../tally/outbox';
import {
  ensureProjectionVersion,
  fold,
  PROJECTION_REBUILDING_KEY,
  PROJECTION_VERSION,
  PROJECTION_VERSION_KEY,
  REPLAY_STRETCH_MS,
  rebuild,
} from './projection';
import { insertRawDocument } from './rawDocuments';

const AT = Math.floor(Date.UTC(2026, 8, 29, 12, 0, 0) / 1000);
const POISON = 7001;
/** A row no Raw Document holds, standing for what a replay wrote before it was cut short. */
const LEFT_BY_REPLAY = 424242;

let db: SQLiteDatabase;

beforeEach(async () => {
  ({ db } = await openTestStore());
  await turnSharingOn(db, '3b9f0c52-8a0e-4c2f-9a41-6f1d2b7e9c10', Date.now());
  errorReports.setSink(db);
});

async function putPurchases(...itemIds: number[]): Promise<void> {
  for (const [i, itemId] of itemIds.entries()) {
    const payload = feedPayload({ entries: [purchaseAt(itemId, AT - i * 60)] });
    await insertRawDocument(db, { endpoint: FEED_UPDATES_ENDPOINT, payload, fetchedAt: new Date((AT + i) * 1000).toISOString() });
  }
}

async function ids(table: 'stories' | 'releases'): Promise<number[]> {
  return (await db.getAllAsync<{ item_id: number }>(`select item_id from ${table} order by item_id`)).map((row) => row.item_id);
}

async function reportedCodes(): Promise<(string | null)[]> {
  const rows = await db.getAllAsync<{ body: string }>("select body from tally_outbox where kind = 'error' order by seq");
  return rows.map((row) => (JSON.parse(row.body) as ErrorReport).code);
}

async function setKv(key: string, value: number): Promise<void> {
  await db.runAsync('insert into kv (key, value) values (?, ?) on conflict (key) do update set value = excluded.value', [key, String(value)]);
}

async function leftByReplay(): Promise<boolean> {
  return (await db.getFirstAsync('select fan_id from fans where fan_id = ?', [LEFT_BY_REPLAY])) !== null;
}

test('a document whose upsert throws is rolled back and passed, the ones after it fold, and a rebuild retries it', async () => {
  // A Story the store refuses, as a constraint or a parser bug past the payload check would throw.
  await db.execAsync(`create trigger poison before insert on stories when new.item_id = ${POISON} begin select raise(abort, 'poison'); end`);
  await putPurchases(7000, POISON, 7002);

  const summary = await fold(db);

  assert.equal(summary.documentsFailed, 1);
  assert.deepEqual(await ids('stories'), [7000, 7002]);
  assert.deepEqual(await ids('releases'), [7000, 7002], "the poisoned document's Release rolled back with it");
  const failed = await db.getAllAsync<{ raw_document_id: number; endpoint: string; error: string }>('select * from projection_failures');
  assert.deepEqual(failed.map((row) => ({ ...row })), [{ raw_document_id: 2, endpoint: FEED_UPDATES_ENDPOINT, error: 'Error' }]);
  assert.equal((await fold(db)).documentsFailed, 0, 'the cursor passed it, so the next fold does not meet it again');
  assert.deepEqual(await reportedCodes(), ['fold_failed']);

  await db.execAsync('drop trigger poison');
  await rebuild(db);
  assert.deepEqual(await ids('stories'), [7000, POISON, 7002]);
  assert.deepEqual(await db.getAllAsync('select * from projection_failures'), []);
});

test('a store failure fails the fold with the cursor where it was, and the next fold projects the document', async () => {
  // SQLite's own message for SQLITE_FULL from a write that rolled back only its statement. A real full disk in node:sqlite
  // ends the whole transaction, which already failed the stretch, so a trigger stands in for the statement-only case.
  await db.execAsync(`create trigger full before insert on stories begin select raise(abort, 'database or disk is full'); end`);
  await putPurchases(7000, 7001);

  await assert.rejects(fold(db), /database or disk is full/);

  assert.deepEqual(await db.getAllAsync('select * from projection_failures'), []);
  assert.deepEqual(await db.getAllAsync('select * from projection_progress'), []);
  assert.deepEqual(await db.getAllAsync('select * from projection_observation_progress'), []);
  assert.deepEqual(await reportedCodes(), []);
  await db.execAsync('drop trigger full');
  assert.equal((await fold(db)).documentsProcessed, 2);
  assert.deepEqual(await ids('stories'), [7000, 7001]);
});

test('a replay cut short resumes from the cursors on the next launch and empties nothing', async () => {
  await putPurchases(7000, 7001, 7002);
  await rebuild(db);
  // The state a kill after the first document leaves: the marker set, the cursor at that document, its rows held.
  await setKv(PROJECTION_REBUILDING_KEY, PROJECTION_VERSION);
  await setKv(PROJECTION_VERSION_KEY, PROJECTION_VERSION - 1);
  await db.runAsync('update projection_progress set last_raw_id = 1');
  await db.runAsync('update projection_observation_progress set last_observation_id = 1');
  await db.runAsync('delete from stories where item_id <> 7000');
  await db.runAsync("insert into fans (fan_id, username, first_seen_at, last_seen_at) values (?, 'held', '', '')", [LEFT_BY_REPLAY]);

  assert.equal(await ensureProjectionVersion(db), true);

  assert.equal(await leftByReplay(), true);
  assert.deepEqual(await ids('stories'), [7000, 7001, 7002]);
  assert.equal(await db.getFirstAsync('select value from kv where key = ?', [PROJECTION_REBUILDING_KEY]), null);
  assert.equal(await ensureProjectionVersion(db), false);
});

test('a replay reports its progress after each stretch, counting a resumed one from where it starts', async (t) => {
  await putPurchases(7000, 7001, 7002);
  // A clock that moves a whole stretch every time it is read, so each document ends a stretch.
  let clock = 0;
  t.mock.method(Date, 'now', () => (clock += REPLAY_STRETCH_MS));
  const fresh: [number, number][] = [];
  await rebuild(db, (done, total) => fresh.push([done, total]));
  assert.deepEqual(fresh, [[1, 3], [2, 3], [3, 3]]);

  await setKv(PROJECTION_REBUILDING_KEY, PROJECTION_VERSION);
  await db.runAsync('update projection_progress set last_raw_id = 1');
  await db.runAsync('update projection_observation_progress set last_observation_id = 1');
  const resumed: [number, number][] = [];
  await ensureProjectionVersion(db, (done, total) => resumed.push([done, total]));
  assert.deepEqual(resumed, [[2, 3], [3, 3]]);
});

test('a replay cut short on its way to another version starts over', async () => {
  await putPurchases(7000);
  await rebuild(db);
  await setKv(PROJECTION_REBUILDING_KEY, PROJECTION_VERSION + 1);
  await db.runAsync("insert into fans (fan_id, username, first_seen_at, last_seen_at) values (?, 'held', '', '')", [LEFT_BY_REPLAY]);

  assert.equal(await ensureProjectionVersion(db), true);
  assert.equal(await leftByReplay(), false);
  assert.deepEqual(await ids('stories'), [7000]);
});

test('a Projection newer than the code, as a rolled back update leaves it, is kept and reported', async () => {
  await putPurchases(7000);
  await rebuild(db);
  await setKv(PROJECTION_VERSION_KEY, PROJECTION_VERSION + 1);
  await db.runAsync("insert into fans (fan_id, username, first_seen_at, last_seen_at) values (?, 'held', '', '')", [LEFT_BY_REPLAY]);

  assert.equal(await ensureProjectionVersion(db), false);
  assert.equal(await leftByReplay(), true);
  assert.deepEqual(await reportedCodes(), ['projection_newer']);
});

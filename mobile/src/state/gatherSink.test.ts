/// <reference types="node" />
/**
 * The sink's fold hook behind `projection_skipped`: each fold after a turn's documents hands its skipped
 * counts to `onFold`, on the real store. The launch's replay makes the wishlist due again (review finding ARCH-3).
 */
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { mock, test } from 'node:test';

import { FAN_ID, feedPayload, fpEntry, purchaseAt } from '../../test/fixtures';
import { openTestStore } from '../../test/nodeDb';
import type { SkippedCounts } from '../domain/types';
import { EMPTY_GATHER_STATE, type GatherState } from '../fetcher/sink';
import { runGatherTurn, type GatherSession } from '../fetcher/turn';
import { readKv, writeKv } from '../store/kv';
import { PROJECTION_REBUILDING_KEY, PROJECTION_VERSION, PROJECTION_VERSION_KEY, REPLAY_STRETCH_MS, rebuild } from '../store/projection';
import { listStoryRows, readWishlistState } from '../store/queries';
import { countForProjection, insertRawDocument } from '../store/rawDocuments';
import { errorReports } from '../tally/errors';
import { turnSharingOn } from '../tally/outbox';
import { projectionSkipped } from '../tally/tally';
import { createGatherSink, GATHER_KEY, replayAtLaunch } from './gatherSink';

const AT = Math.floor(Date.UTC(2026, 8, 29, 12, 0, 0) / 1000);

async function foldOnce(entries: readonly unknown[]): Promise<SkippedCounts[]> {
  const { db } = await openTestStore();
  mock.method(console, 'log', () => undefined);
  const heard: SkippedCounts[] = [];
  const sink = createGatherSink({ db, setGather: () => undefined, invalidate: () => undefined, onFold: (skipped) => heard.push(skipped) });
  await sink.putRaw({ endpoint: 'fan_dash_feed_updates', payload: feedPayload({ entries }), fetchedAt: new Date(AT * 1000).toISOString() });
  await sink.afterDocuments();
  mock.restoreAll();
  return heard;
}

test('a fold that skips an entry it cannot read and one of an unknown kind hands both counts over once', async () => {
  const heard = await foldOnce([purchaseAt(1001, AT), 'not an entry', fpEntry({ story_type: 'zz' })]);
  assert.deepEqual(heard, [{ unparsable: 1, unknownStoryType: 1, missingFanInfo: 0 }]);
  assert.deepEqual(projectionSkipped(heard[0]!), {
    name: 'projection_skipped',
    props: { unparsable: '1', unknown_story_type: '1', missing_fan_info: '0' },
  });
});

test('a fold that skips nothing makes no Tally', async () => {
  const heard = await foldOnce([purchaseAt(1001, AT)]);
  assert.equal(heard.length, 1);
  assert.equal(projectionSkipped(heard[0]!), null);
});

test('a rebuilt wishlist is confirmed by the next automatic turn despite a recent attempt; a normal drain retains its gates', async (t) => {
  for (const heldVersion of [PROJECTION_VERSION - 1, PROJECTION_VERSION]) {
    await t.test(`held version ${heldVersion}`, async (t) => {
      const { db, close } = await openTestStore();
      t.after(close);
      const now = AT * 1000 + 60_000;
      const fetchedAt = new Date(now).toISOString();
      const identity = { fanId: FAN_ID, username: 'diggerfan' };
      const fetched: GatherState = {
        ...EMPTY_GATHER_STATE, identity, initialWalkDone: true,
        wishlistFetchedAt: AT * 1000, wishlistAskedAt: AT * 1000,
        followsFetchedAt: AT * 1000, followsAskedAt: AT * 1000,
      };
      await writeKv(db, GATHER_KEY, fetched);
      await writeKv(db, PROJECTION_VERSION_KEY, heldVersion);
      // A confirmed press is derived state with no Raw Document to recover it from (ARCH-3).
      await db.runAsync("insert into wishlist_items (item_type, item_id, last_seen_snapshot_at) values ('a', 1001, '')");
      const deps = { db, setGather: () => undefined, invalidate: () => undefined };
      const rebuilding = heldVersion < PROJECTION_VERSION;
      assert.equal(await replayAtLaunch(deps), rebuilding);
      assert.equal((await readWishlistState(db)).items.length, rebuilding ? 0 : 1);
      let asks = 0;
      const unexpected = async (): Promise<never> => { throw new Error('unexpected request'); };
      const session: GatherSession = {
        probeIdentity: async () => ({ kind: 'ok', value: identity }),
        pokeFeedPage: async () => ({ kind: 'ok', value: { endpoint: 'fan_feed_page', payload: { url: '/diggerfan/feed', status: 200, bytes: 0 }, fetchedAt } }),
        fetchFeedUpdates: async () => ({
          kind: 'ok', value: { document: { endpoint: 'fan_dash_feed_updates', payload: feedPayload({ entries: [] }), fetchedAt }, entryCount: 0, oldestStoryDate: null, newestStoryDate: null },
        }),
        async fetchWishlistItems(_fanId, onDocument) {
          asks += 1;
          const inputToken = `${Math.floor(now / 1000)}::a::`;
          await onDocument({
            endpoint: 'wishlist_items', fetchedAt,
            payload: {
              snapshot_started_at: fetchedAt, request: { fan_id: FAN_ID, older_than_token: inputToken },
              response: { items: [{ tralbum_type: 'a', tralbum_id: 1001 }], more_available: false },
              snapshotPage: { number: 1, inputToken, nextToken: null },
            },
          });
          return { kind: 'ok', value: { pages: 1, seen: 1, complete: true } };
        },
        fetchFollowingBands: unexpected, fetchBandDetails: unexpected, fetchReleasePage: unexpected,
      };

      assert.equal((await runGatherTurn(session, createGatherSink(deps), { now: () => now, reason: 'open', budgetMs: 60_000 })).outcome, 'done');
      assert.equal(asks, rebuilding ? 1 : 0, 'the next open must confirm membership erased by the rebuild');
      assert.deepEqual(await readWishlistState(db), { items: [{ itemType: 'a', itemId: '1001', wishlisted: true, pending: null }] });
      const state = await readKv<GatherState>(db, GATHER_KEY);
      assert.deepEqual([state?.wishlistFetchedAt, state?.wishlistAskedAt], rebuilding ? [now, now] : [AT * 1000, AT * 1000]);
      assert.deepEqual([state?.followsFetchedAt, state?.followsAskedAt], [AT * 1000, AT * 1000]);
    });
  }
});

test('a current-version launch projects the committed backlog before queries, preserving held rows and wishlist freshness', async (t) => {
  mkdirSync('build', { recursive: true });
  const directory = mkdtempSync('build/startup-');
  const file = join(directory, 'store.db');
  let store = await openTestStore(file);
  t.after(() => {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const put = (itemId: number) => insertRawDocument(store.db, {
    endpoint: 'fan_dash_feed_updates', payload: feedPayload({ entries: [purchaseAt(itemId, AT)] }),
    fetchedAt: new Date(AT * 1000).toISOString(),
  });
  await put(1001);
  await rebuild(store.db);
  const fetched = { ...EMPTY_GATHER_STATE, wishlistFetchedAt: AT * 1000, wishlistAskedAt: AT * 1000 };
  await writeKv(store.db, GATHER_KEY, fetched);
  await store.db.runAsync("insert into wishlist_items (item_type, item_id, last_seen_snapshot_at) values ('a', 1001, ?)", [new Date(AT * 1000).toISOString()]);
  await put(1002);
  await put(1003);
  // The response commits, then the process disappears before afterDocuments.
  store.close();
  store = await openTestStore(file);
  assert.deepEqual(await countForProjection(store.db), { held: 3, waiting: 2 });
  const progress: [number, number][] = [];
  let clock = AT * 1000;
  t.mock.method(Date, 'now', () => (clock += REPLAY_STRETCH_MS));

  const replayed = await replayAtLaunch({ db: store.db, setGather: () => undefined, invalidate: () => undefined }, (done, total) => progress.push([done, total]));

  assert.deepEqual((await listStoryRows(store.db)).map((row) => row.itemId).sort((a, b) => a - b), [1001, 1002, 1003]);
  assert.equal(replayed, false, 'a backlog drain does not rebuild the Projection');
  assert.deepEqual(await countForProjection(store.db), { held: 3, waiting: 0 });
  assert.deepEqual(progress, [[2, 3], [3, 3]]);
  assert.deepEqual(await readKv(store.db, GATHER_KEY), fetched);
  assert.deepEqual(await readWishlistState(store.db), { items: [{ itemType: 'a', itemId: '1001', wishlisted: true, pending: null }] });
  assert.equal(await readKv(store.db, PROJECTION_VERSION_KEY), PROJECTION_VERSION);
  assert.equal(await readKv(store.db, PROJECTION_REBUILDING_KEY), null);
});

test('startup retains pending observations on a store failure or a newer Projection, and invalidates wishlist only after a rebuild began', async (t) => {
  for (const heldVersion of [PROJECTION_VERSION, PROJECTION_VERSION - 1, PROJECTION_VERSION + 1]) {
    await t.test(`held version ${heldVersion}`, async (t) => {
      const { db, close } = await openTestStore();
      t.after(() => { errorReports.setSink(null); close(); });
      t.mock.method(console, 'warn', () => undefined);
      await turnSharingOn(db, '3b9f0c52-8a0e-4c2f-9a41-6f1d2b7e9c10', AT * 1000);
      errorReports.setSink(db);
      await writeKv(db, PROJECTION_VERSION_KEY, heldVersion);
      await writeKv(db, GATHER_KEY, { ...EMPTY_GATHER_STATE, wishlistFetchedAt: AT * 1000, wishlistAskedAt: AT * 1000 });
      await db.runAsync("insert into wishlist_items (item_type, item_id, last_seen_snapshot_at) values ('a', 1001, '')");
      await insertRawDocument(db, {
        endpoint: 'fan_dash_feed_updates', payload: feedPayload({ entries: [purchaseAt(1002, AT)] }),
        fetchedAt: new Date(AT * 1000).toISOString(),
      });
      await db.execAsync("create trigger full before insert on stories begin select raise(abort, 'database or disk is full'); end");

      const replayed = await replayAtLaunch({ db, setGather: () => undefined, invalidate: () => undefined });

      const rebuilding = heldVersion < PROJECTION_VERSION;
      assert.equal(replayed, rebuilding);
      assert.deepEqual(await countForProjection(db), { held: 1, waiting: 1 });
      assert.deepEqual(await listStoryRows(db), []);
      assert.deepEqual(await db.getAllAsync('select * from projection_failures'), [], 'a store failure must not quarantine the document');
      assert.equal((await readKv<GatherState>(db, GATHER_KEY))?.wishlistFetchedAt, rebuilding ? null : AT * 1000);
      assert.equal((await readKv<GatherState>(db, GATHER_KEY))?.wishlistAskedAt, rebuilding ? null : AT * 1000);
      assert.equal((await readWishlistState(db)).items.length, rebuilding ? 0 : 1);
      assert.equal(await readKv(db, PROJECTION_REBUILDING_KEY), rebuilding ? PROJECTION_VERSION : null);
      assert.equal(await readKv(db, PROJECTION_VERSION_KEY), heldVersion);
      const reports = await db.getAllAsync<{ body: string }>("select body from tally_outbox where kind = 'error'");
      assert.deepEqual(reports.map((row) => (JSON.parse(row.body) as { code: string }).code), [heldVersion > PROJECTION_VERSION ? 'projection_newer' : 'projection_replay_failed']);

      if (heldVersion <= PROJECTION_VERSION) {
        await db.execAsync('drop trigger full');
        assert.equal(await replayAtLaunch({ db, setGather: () => undefined, invalidate: () => undefined }), rebuilding);
        assert.deepEqual((await listStoryRows(db)).map((row) => row.itemId), [1002]);
        assert.deepEqual(await countForProjection(db), { held: 1, waiting: 0 });
        assert.equal(await readKv(db, PROJECTION_REBUILDING_KEY), null);
      }
    });
  }
});

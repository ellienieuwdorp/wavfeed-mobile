/// <reference types="node" />
/**
 * The sink's fold hook behind `projection_skipped` (task 0038): each fold after a turn's documents hands its skipped
 * counts to `onFold`, on the real store. The launch's replay makes the wishlist due again (review finding ARCH-3).
 */
import assert from 'node:assert/strict';
import { mock, test } from 'node:test';

import { feedPayload, fpEntry, purchaseAt } from '../../test/fixtures';
import { openTestStore } from '../../test/nodeDb';
import type { SkippedCounts } from '../domain/types';
import { EMPTY_GATHER_STATE, type GatherState } from '../fetcher/sink';
import { readKv, writeKv } from '../store/kv';
import { PROJECTION_VERSION, PROJECTION_VERSION_KEY } from '../store/projection';
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

test('a launch that replays the Projection makes the wishlist due on the next turn, and one that does not leaves it', async () => {
  const fetched: GatherState = { ...EMPTY_GATHER_STATE, wishlistFetchedAt: AT * 1000, wishlistAskedAt: AT * 1000 };
  const launch = async (heldVersion: number) => {
    const { db } = await openTestStore();
    await writeKv(db, GATHER_KEY, fetched);
    await writeKv(db, PROJECTION_VERSION_KEY, heldVersion);
    const replayed = await replayAtLaunch({ db, setGather: () => undefined, invalidate: () => undefined });
    const stored = await readKv<GatherState>(db, GATHER_KEY);
    return { replayed, fetchedAt: stored?.wishlistFetchedAt, askedAt: stored?.wishlistAskedAt };
  };

  assert.deepEqual(await launch(PROJECTION_VERSION - 1), { replayed: true, fetchedAt: null, askedAt: AT * 1000 });
  assert.deepEqual(await launch(PROJECTION_VERSION), { replayed: false, fetchedAt: AT * 1000, askedAt: AT * 1000 });
});

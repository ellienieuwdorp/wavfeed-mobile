/// <reference types="node" />
/**
 * The sink's fold hook behind `projection_skipped` (task 0038): each fold after a turn's documents hands its skipped
 * counts to `onFold`, on the real store.
 */
import assert from 'node:assert/strict';
import { mock, test } from 'node:test';

import { feedPayload, fpEntry, purchaseAt } from '../../test/fixtures';
import { openTestStore } from '../../test/nodeDb';
import type { SkippedCounts } from '../domain/types';
import { projectionSkipped } from '../tally/tally';
import { createGatherSink } from './gatherSink';

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

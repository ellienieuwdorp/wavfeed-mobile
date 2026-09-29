/// <reference types="node" />
/**
 * The release-date worklist (ADR-0011): undated Releases a Story reaches, newest Story first; a page that answered
 * without a date waits a day, and a week once it has failed three times running.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { feedPayload, purchaseAt } from '../../test/fixtures';
import { DAY } from '../../test/history';
import { openTestStore } from '../../test/nodeDb';
import { markReleasePageAttempt, readUndatedReleases } from './enrichment';
import { fold } from './projection';
import { insertRawDocument } from './rawDocuments';

const NOW = Date.UTC(2026, 8, 25, 12, 0, 0);

test('an attempted page waits a day, and a week after three failures', async () => {
  const { db, close } = await openTestStore();
  const at = Math.floor(NOW / 1000) - 3600;
  const payload = feedPayload({ entries: [purchaseAt(11, at), purchaseAt(12, at - 60)] });
  await insertRawDocument(db, { endpoint: 'fan_dash_feed_updates', payload, fetchedAt: new Date(NOW).toISOString() });
  await fold(db);
  const due = async (ms: number): Promise<number[]> => (await readUndatedReleases(db, 10, new Date(ms))).map((r) => r.itemId);

  assert.deepEqual(await due(NOW), [11, 12]);

  await markReleasePageAttempt(db, { itemType: 'a', itemId: 11 }, 'undated', new Date(NOW));
  assert.deepEqual(await due(NOW + DAY - 1), [12]);
  assert.deepEqual(await due(NOW + DAY), [11, 12]);

  await markReleasePageAttempt(db, { itemType: 'a', itemId: 11 }, 'failed', new Date(NOW + DAY));
  assert.deepEqual(await due(NOW + 2 * DAY), [11, 12], 'two failures still wait a day');
  await markReleasePageAttempt(db, { itemType: 'a', itemId: 11 }, 'unparsable', new Date(NOW + 2 * DAY));
  assert.deepEqual(await due(NOW + 9 * DAY - 1), [12]);
  assert.deepEqual(await due(NOW + 9 * DAY), [11, 12]);
  close();
});

/// <reference types="node" />
/**
 * The release-date worklist (ADR-0011): undated Releases a Story reaches, newest Story first; a page that answered
 * without a date waits a day, and a week once it has failed three times running. A pre-order the feed announces joins
 * it, and the date its page gives outlasts every later read of the same feed entry (task 0041, decision 1). An Upcoming
 * Release's page is due again when a day old or when the feed names more Tracks playing than it did (decision 8).
 * Pre-orders are asked before the rest (task 0067, decision 5).
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  feedPayload,
  PREORDER_ITEM_ID,
  PREORDER_URL,
  preorderNrEntry,
  preorderTralbumBlob,
  purchaseAt,
  releasePagePayload,
} from '../../test/fixtures';
import { DAY } from '../../test/history';
import { openTestStore } from '../../test/nodeDb';
import { FEED_UPDATES_ENDPOINT, RELEASE_PAGE_ENDPOINT } from '../domain/endpoints';
import { markReleasePageAttempt, readUndatedReleases, readUpcomingDue } from './enrichment';
import { fold, rebuild } from './projection';
import { listUpcomingReleases } from './queries';
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

test('an undated pre-order is asked before a Release with a newer Story', async () => {
  const { db, close } = await openTestStore();
  // The pre-order's Story is 29 September, the purchase a week later.
  const payload = feedPayload({ entries: [preorderNrEntry(), purchaseAt(11, Date.UTC(2026, 9, 6) / 1000)] });
  await insertRawDocument(db, { endpoint: FEED_UPDATES_ENDPOINT, payload, fetchedAt: '2026-10-06T12:00:00.000Z' });
  await fold(db);
  const due = await readUndatedReleases(db, 10, new Date(Date.UTC(2026, 9, 6, 12)));
  assert.deepEqual(due.map((release) => release.itemId), [PREORDER_ITEM_ID, 11]);
  close();
});

test("a pre-order the feed announces waits for its release page, and keeps the page's date when the feed says it again", async () => {
  const { db, close } = await openTestStore();
  const now = new Date(Date.UTC(2026, 8, 29, 12, 0, 0));
  // The feed rewrites an entry in place, so a later poll carries the same Story with a field moved.
  const feed = (fetchedAt: string, collected: number) =>
    insertRawDocument(db, {
      endpoint: FEED_UPDATES_ENDPOINT,
      payload: feedPayload({ entries: [preorderNrEntry({ also_collected_count: collected })] }),
      fetchedAt,
    });
  const shelf = async () =>
    (await listUpcomingReleases(db, now)).map((r) => [r.itemId, r.releaseDate.toISOString(), r.numStreamableTracks, r.numTracks]);

  await feed('2026-09-29T10:00:00.000Z', 3);
  await fold(db);
  assert.deepEqual(await readUndatedReleases(db, 10, now), [{ itemType: 'a', itemId: PREORDER_ITEM_ID, url: PREORDER_URL }]);
  assert.deepEqual(await shelf(), []);

  const page = releasePagePayload({ itemId: PREORDER_ITEM_ID, itemUrl: PREORDER_URL, tralbum: preorderTralbumBlob() });
  await insertRawDocument(db, { endpoint: RELEASE_PAGE_ENDPOINT, payload: page, fetchedAt: '2026-09-29T10:05:00.000Z' });
  await feed('2026-09-29T11:00:00.000Z', 4);
  await fold(db);

  const dated = [[PREORDER_ITEM_ID, '2026-10-13T00:00:00.000Z', 1, 4]];
  assert.deepEqual(await shelf(), dated);
  assert.deepEqual(await readUndatedReleases(db, 10, now), []);
  await rebuild(db);
  assert.deepEqual(await shelf(), dated);
  close();
});

test('an Upcoming page is due once a day old, at once when the feed names more Tracks playing, and a failure still waits', async () => {
  const { db, close } = await openTestStore();
  const read = async (endpoint: string, payload: unknown, fetchedAt: string) => {
    await insertRawDocument(db, { endpoint, payload, fetchedAt });
    await fold(db);
  };
  const feed = (playing: number, collected: number) =>
    feedPayload({ entries: [preorderNrEntry({ num_streamable_tracks: playing, also_collected_count: collected })] });
  const due = async (iso: string): Promise<number[]> => (await readUpcomingDue(db, 10, new Date(iso))).map((r) => r.itemId);
  const key = { itemType: 'a', itemId: PREORDER_ITEM_ID } as const;

  await read(FEED_UPDATES_ENDPOINT, feed(1, 3), '2026-09-29T10:00:00.000Z');
  assert.deepEqual(await due('2026-09-29T10:01:00.000Z'), [], 'undated, it waits on the undated list');
  const page = releasePagePayload({ itemId: PREORDER_ITEM_ID, itemUrl: PREORDER_URL, tralbum: preorderTralbumBlob() });
  await read(RELEASE_PAGE_ENDPOINT, page, '2026-09-29T10:05:00.000Z');
  await markReleasePageAttempt(db, key, 'dated', new Date('2026-09-29T10:05:00.000Z'));
  assert.deepEqual(await due('2026-09-30T10:04:59.000Z'), []);
  assert.deepEqual(await due('2026-09-30T10:05:00.000Z'), [PREORDER_ITEM_ID]);

  await read(FEED_UPDATES_ENDPOINT, feed(2, 4), '2026-09-29T11:00:00.000Z');
  assert.deepEqual(await due('2026-09-29T11:01:00.000Z'), [PREORDER_ITEM_ID], 'the feed is ahead of the page');
  await markReleasePageAttempt(db, key, 'failed', new Date('2026-09-29T11:02:00.000Z'));
  assert.deepEqual(await due('2026-09-29T11:03:00.000Z'), [], 'asked since the feed spoke, the failure waits a day');
  assert.deepEqual(await due('2026-09-30T11:02:00.000Z'), [PREORDER_ITEM_ID]);

  // Three failures running wait a week, and a feed read that only moves another field does not cut the wait short.
  await markReleasePageAttempt(db, key, 'failed', new Date('2026-09-30T11:10:00.000Z'));
  await markReleasePageAttempt(db, key, 'failed', new Date('2026-09-30T11:20:00.000Z'));
  await read(FEED_UPDATES_ENDPOINT, feed(2, 5), '2026-09-30T12:00:00.000Z');
  assert.deepEqual(await due('2026-10-01T12:01:00.000Z'), []);
  assert.deepEqual(await due('2026-10-07T11:20:00.000Z'), [PREORDER_ITEM_ID]);
  close();
});

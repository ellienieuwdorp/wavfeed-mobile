/// <reference types="node" />
/**
 * The Demo through the store: a feed of real Releases with art and previews, pre-orders on the Upcoming
 * shelf, a Burst, and Fans with no face; the store's Fan is the Demo Fan with its first walk done.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { openTestStore } from '../../test/nodeDb';
import type { GatherState } from '../fetcher/sink';
import { GATHER_KEY } from '../state/gatherSink';
import { IDENTITY_KEY, readKv, type StoredIdentity } from '../store';
import { listStoryRows, listUpcomingReleases, readOverview } from '../store/queries';
import { DEMO_FAN_ID, isDemoFan, loadDemo } from './demo';
import { demoReleases } from './releases';

const NOW = Date.parse('2026-09-30T12:00:00Z');

test('the Demo fills a store with real Releases, made-up Fans and a finished first walk', async () => {
  const { db, close } = await openTestStore();
  try {
    await loadDemo(db, NOW);
    const overview = await readOverview(db);
    assert.equal(overview.releaseCount, demoReleases.pages.length);
    assert.ok(overview.storyCount > 100, `${overview.storyCount} Stories`);

    const rows = await listStoryRows(db);
    assert.ok(rows.every((row) => row.storyDate.getTime() < NOW), 'no Story after the load');
    const faces = await db.getFirstAsync<{ n: number }>('select count(*) as n from fans where image_id is not null');
    assert.equal(faces?.n, 0);
    const art = await db.getFirstAsync<{ n: number }>('select count(*) as n from releases where art_id is null');
    assert.equal(art?.n, 0);

    const upcoming = await listUpcomingReleases(db, new Date(NOW));
    assert.ok(upcoming.length >= 5, `${upcoming.length} Upcoming Releases`);

    const identity = await readKv<StoredIdentity>(db, IDENTITY_KEY);
    assert.equal(identity?.fanId, DEMO_FAN_ID);
    assert.ok(isDemoFan(identity?.fanId));
    const gather = await readKv<GatherState>(db, GATHER_KEY);
    assert.equal(gather?.initialWalkDone, true);
    assert.notEqual(gather?.wishlistAskedAt ?? null, null, 'every heart takes a press');
  } finally {
    close();
  }
});

test('the Demo writes the same documents for the same moment', async () => {
  const hashes: string[] = [];
  for (let n = 0; n < 2; n += 1) {
    const { db, close } = await openTestStore();
    try {
      await loadDemo(db, NOW);
      const row = await db.getFirstAsync<{ h: string }>("select group_concat(content_hash, ',') as h from (select content_hash from raw_documents order by id)");
      hashes.push(row?.h ?? '');
    } finally {
      close();
    }
  }
  assert.equal(hashes[0], hashes[1]);
});

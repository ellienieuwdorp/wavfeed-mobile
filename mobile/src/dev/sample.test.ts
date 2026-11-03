/// <reference types="node" />
/**
 * The simulator rig's sample through the store: New releases' shelf carries a Release with Tracks out early
 * that a Fan bought, so the rig shows a card with its count and the faces, and the rig's first walk shows the catch-up mid-way with a fill.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { openTestStore } from '../../test/nodeDb';
import { backTo, catchUpHeader, soFar, tracksOutPhrase } from '../copy';
import { EMPTY_GATHER_STATE, type GatherState, type WalkState } from '../fetcher/sink';
import { IDENTITY_KEY, readKv, type StoredIdentity, writeKv } from '../store/kv';
import { readNewReleases } from '../store/queries';
import { GATHER_KEY, readStoredWalk, WALK_KEY } from '../state/gatherSink';
import { walkProgress } from '../state/walkProgress';
import { loadSampleData, SAMPLE_WALK_STORIES, sampleWalk, setSampleWalk } from './sample';

test("New releases' shelf in the sample holds a bought card with Tracks out early", async () => {
  const { db, close } = await openTestStore();
  try {
    await loadSampleData(db);
    const { upcoming } = await readNewReleases(db, { now: new Date('2026-09-29T12:00:00Z') });
    const counted = upcoming.map((r) => [r.title, tracksOutPhrase(r.numStreamableTracks, r.numTracks), r.buyers.length > 0]);
    assert.ok(counted.some(([, count]) => count === null), 'a card with no Track out still sits beside it');
    assert.ok(counted.some(([title, count, bought]) => title === 'Weathered Signals' && count === '3 of 6 tracks' && bought), JSON.stringify(counted));
  } finally {
    close();
  }
});

test("the rig's first walk shows the catch-up mid-way with a fill, and finishes again", async () => {
  const { db, close } = await openTestStore();
  let gather: GatherState = EMPTY_GATHER_STATE;
  const deps = { db, setGather: (state: GatherState) => (gather = state), invalidate: () => undefined };
  try {
    await loadSampleData(db);
    await setSampleWalk(deps, true);
    assert.equal(gather.initialWalkDone, false);
    const walk = await readStoredWalk(db);
    const { reachedAt, fraction } = walkProgress(walk, gather.storiesSoFar);
    assert.ok(fraction !== null && fraction > 0.2 && fraction < 0.5, `fraction ${fraction}`);
    assert.equal(catchUpHeader(soFar(SAMPLE_WALK_STORIES), reachedAt === null ? null : backTo(reachedAt)), '2,960 so far, back to June 2026');

    await setSampleWalk(deps, false);
    assert.equal(await readStoredWalk(db), null);
    assert.equal(gather.initialWalkDone, true);
  } finally {
    close();
  }
});

test("the rig's first walk leaves a real Fan's walk and gather state alone", async () => {
  const { db, close } = await openTestStore();
  const deps = { db, setGather: () => undefined, invalidate: () => undefined };
  try {
    const identity: StoredIdentity = { fanId: 4_242, username: 'diggerfan', name: null, avatarUrl: null };
    const own: WalkState = { ...sampleWalk(), fanId: identity.fanId, username: identity.username, pagesDone: 12 };
    const gather: GatherState = { ...EMPTY_GATHER_STATE, identity: { fanId: identity.fanId, username: identity.username }, storiesSoFar: 240 };
    await writeKv(db, IDENTITY_KEY, identity);
    await writeKv(db, WALK_KEY, own);
    await writeKv(db, GATHER_KEY, gather);
    await loadSampleData(db);
    for (const on of [true, false]) {
      await setSampleWalk(deps, on);
      assert.deepEqual(await readStoredWalk(db), own, `walk=${on ? 1 : 0}`);
      assert.deepEqual(await readKv(db, GATHER_KEY), gather, `walk=${on ? 1 : 0}`);
    }
  } finally {
    close();
  }
});

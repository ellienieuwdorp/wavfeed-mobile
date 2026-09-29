/// <reference types="node" />
/**
 * The simulator rig's sample through the store (task 0036): Bought's shelf carries a Release with Tracks out early, so
 * the rig shows a card with its count above the faces (task 0041, decisions 9 and 10).
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { openTestStore } from '../../test/nodeDb';
import { tracksOutPhrase } from '../copy';
import { boughtHalves } from '../domain/boughtChart';
import { readBoughtReleases } from '../store/queries';
import { loadSampleData } from './sample';

test('Bought shelf in the sample holds a card with Tracks out early', async () => {
  const { db, close } = await openTestStore();
  try {
    await loadSampleData(db);
    const { upcoming } = boughtHalves(await readBoughtReleases(db), new Date('2026-09-29T12:00:00Z'));
    const counted = upcoming.map((r) => [r.item.title, tracksOutPhrase(r.item.numStreamableTracks, r.item.numTracks)]);
    assert.ok(counted.some(([, count]) => count === null), 'a card with no Track out still sits beside it');
    assert.deepEqual(
      counted.filter(([, count]) => count !== null),
      [['Weathered Signals', '3 of 6 tracks']],
    );
  } finally {
    close();
  }
});

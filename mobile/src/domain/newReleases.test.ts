/// <reference types="node" />
/**
 * Where New releases places a Drop (task 0041, decision 10): on its own day beside the Releases, except on the day the
 * Release's own row sits, which stands for it; the Drops before stay where they happened.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { newReleaseRow } from '../../test/rows';
import { assembleFeed } from './assemble';
import { buildNewReleases, type Drop } from './newReleases';
import { buildUpcoming } from './upcoming';

test("a Drop on the day of the Release's own row is left to that row, and an earlier one keeps its place", () => {
  const out = new Date('2026-10-13T00:00:00.000Z');
  const story = newReleaseRow({ itemId: 5001, releaseDate: out, storyDate: new Date('2026-09-29T09:12:40.000Z') });
  const { elements } = assembleFeed([story], { types: ['new_release'], sort: 'anchor' });
  const [release] = buildUpcoming([{ ...story, releaseDate: out, isPreorder: true }], []);
  assert.ok(release !== undefined);
  const drop = (day: string): Drop => ({ release, day, tracksOut: 2, numTracks: 4, newestTrackId: null });

  const view = buildNewReleases(elements, [], new Date('2026-10-14T12:00:00.000Z'), [drop('2026-10-13'), drop('2026-10-03')]);

  assert.deepEqual(
    view.weeks.flatMap((week) => week.releases.map((placed) => [placed.kind, placed.key])),
    [
      ['release', 'item:a:5001'],
      ['drop', 'drop:a:5001:2026-10-03'],
    ],
  );
});

/// <reference types="node" />
/**
 * Where New releases places a Drop (task 0041, decision 10): on its own day beside the Releases, except on the day the
 * Release's own row sits, which stands for it; the Drops before stay where they happened. Released rows carry their
 * buyers (task 0071, decision 19), and the Releases followed Fans bought join the weeks (decision 20, Open 9).
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { newReleaseRow, storyRow } from '../../test/rows';
import { assembleFeed } from './assemble';
import { buildNewReleases, type Drop, newReleasesOf } from './newReleases';
import type { FeedStoryRow } from './rows';
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

test('a released Feed Item carries the buyers of its purchase Stories and keeps the place its new-release Story gives it', () => {
  const now = new Date('2026-10-14T12:00:00.000Z');
  const announced = newReleaseRow({ itemId: 5001, releaseDate: new Date('2026-10-06T00:00:00.000Z'), storyDate: new Date('2026-10-08T09:00:00.000Z') });
  const bought = [
    storyRow({ itemId: 5001, fanId: 202, fanUsername: 'kessler_digs', storyDate: new Date('2026-10-09T09:00:00.000Z') }),
    storyRow({ itemId: 5001, storyDate: new Date('2026-10-10T09:00:00.000Z') }),
  ];
  const placed = (stories: readonly FeedStoryRow[]) =>
    newReleasesOf({ stories, upcoming: [], drops: [], now }).weeks.flatMap((week) =>
      week.releases.map((entry) => ({ key: entry.key, date: entry.date, buyers: 'buyers' in entry.release ? entry.release.buyers.map((fan) => fan.username) : [] })),
    );

  assert.deepEqual(placed([announced]), [{ key: 'item:a:5001', date: new Date(2026, 9, 6), buyers: [] }]);
  assert.deepEqual(placed([announced, ...bought]), [{ key: 'item:a:5001', date: new Date(2026, 9, 6), buyers: ['dj_okonkwo', 'kessler_digs'] }]);
});

test('a Release followed Fans bought joins its local week on its release day; an undated one or one not out does not', () => {
  const now = new Date('2026-10-14T12:00:00.000Z');
  const stories = [
    newReleaseRow({ itemId: 5001, releaseDate: new Date('2026-10-06T00:00:00.000Z'), storyDate: new Date('2026-10-08T09:00:00.000Z') }),
    storyRow({ itemId: 5001, releaseDate: new Date('2026-10-06T00:00:00.000Z') }),
    storyRow({ itemId: 6001, releaseDate: new Date('2026-10-07T00:00:00.000Z') }),
    storyRow({ itemId: 6002, releaseDate: null }),
    storyRow({ itemId: 6003, releaseDate: new Date('2026-10-20T00:00:00.000Z') }),
  ];

  const { weeks } = newReleasesOf({ stories, upcoming: [], drops: [], now });

  assert.deepEqual(
    weeks.map((week) => [week.weekStart, week.releases.map((entry) => [entry.key, entry.date])]),
    [[new Date(2026, 9, 5), [['bought:a:6001', new Date(2026, 9, 7)], ['item:a:5001', new Date(2026, 9, 6)]]]],
  );
});

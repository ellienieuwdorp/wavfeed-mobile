/// <reference types="node" />
/**
 * The New releases filter (task 0071, decisions 8 and 21): tags as any of them, tags and the people minimum as both,
 * one verdict per Release across the shelf and the weeks, no week left without rows, and the counts the sheet shows.
 * That the counts match the filtered list over a long history is src/store/queries.test.ts.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { newReleaseRow, storyRow } from '../../test/rows';
import type { ApiTag } from './apiTypes';
import { newReleasesOf } from './newReleases';
import { clampMinimum, filterNewReleases, shownTags, type ReleaseFilter } from './releaseFilter';
import type { FeedStoryRow } from './rows';

const NOW = new Date('2026-10-14T12:00:00.000Z');

function tags(...names: string[]): ApiTag[] {
  return names.map((name) => ({ name: name.toUpperCase(), normName: name }));
}

/** A released Release with its new-release Story, bought by `buyers` Fans. */
function released(itemId: number, day: string, tagged: readonly ApiTag[], buyers: number): FeedStoryRow[] {
  const release = { itemId, releaseDate: new Date(`${day}T00:00:00.000Z`), tags: [...tagged] };
  return [
    newReleaseRow({ ...release, storyDate: new Date(`${day}T09:00:00.000Z`) }),
    ...Array.from({ length: buyers }, (_, fan) => storyRow({ ...release, fanId: 300 + fan, fanUsername: `fan${fan}` })),
  ];
}

function view() {
  const shelf = { ...storyRow({ itemId: 5, tags: tags('ambient') }), releaseDate: new Date('2026-10-20T00:00:00.000Z'), isPreorder: true };
  const stories = [
    ...released(1, '2026-10-07', tags('dub', 'ambient'), 3),
    ...released(2, '2026-10-08', tags('techno'), 1),
    ...released(3, '2026-09-30', tags('ambient'), 0),
    ...released(4, '2026-09-16', tags('dub'), 2),
    storyRow({ itemId: 5, fanId: 300, fanUsername: 'fan0', tags: tags('ambient') }),
    storyRow({ itemId: 5, fanId: 301, fanUsername: 'fan1', tags: tags('ambient') }),
  ];
  return newReleasesOf({ stories, upcoming: [shelf], drops: [], now: NOW });
}

function shown(filter: ReleaseFilter) {
  const { view: filtered } = filterNewReleases(view(), filter);
  return {
    shelf: filtered.upcoming.map((release) => release.itemId),
    weeks: filtered.weeks.map((week) => [week.weekStart, week.releases.map((entry) => entry.release.itemId)]),
  };
}

test('the people minimum keeps what that many bought and drops the week it empties', () => {
  assert.deepEqual(shown({ people: { on: true, min: 2 }, tags: [] }), {
    shelf: ['5'],
    weeks: [[new Date(2026, 9, 5), ['1']], [new Date(2026, 8, 14), ['4']]],
  });
});

test('tags keep a Release with any of them, and with the people minimum both must hold', () => {
  assert.deepEqual(shown({ people: { on: false, min: 2 }, tags: ['dub', 'techno'] }), {
    shelf: [],
    weeks: [[new Date(2026, 9, 5), ['2', '1']], [new Date(2026, 8, 14), ['4']]],
  });
  assert.deepEqual(shown({ people: { on: true, min: 2 }, tags: ['ambient'] }), {
    shelf: ['5'],
    weeks: [[new Date(2026, 9, 5), ['1']]],
  });
});

test('with the filter off the view is the one drawn, every Release counted', () => {
  const whole = view();
  const result = filterNewReleases(whole, { people: { on: false, min: 3 }, tags: [] });
  assert.equal(result.view, whole);
  assert.deepEqual([result.total, result.matching], [5, 5]);
});

test('the sheet counts tags after the people filter, each minimum alone, and everything chosen together', () => {
  const result = filterNewReleases(view(), { people: { on: true, min: 2 }, tags: ['dub'] });
  assert.deepEqual(result.tags, [
    { normName: 'ambient', name: 'AMBIENT', count: 2 },
    { normName: 'dub', name: 'DUB', count: 2 },
    { normName: 'techno', name: 'TECHNO', count: 0 },
  ]);
  assert.deepEqual(result.byMinimum.map(({ min, count }) => [min, count]), [[1, 4], [2, 3], [3, 1], [4, 0], [5, 0], [6, 0]]);
  assert.deepEqual([result.total, result.matching], [5, 2]);
});

test('one view filtered tap after tap answers each filter as a view read afresh does', () => {
  const held = view();
  const taps: ReleaseFilter[] = [
    { people: { on: false, min: 2 }, tags: ['dub'] },
    { people: { on: false, min: 2 }, tags: ['dub', 'techno'] },
    { people: { on: false, min: 2 }, tags: ['techno', 'dub'] },
    { people: { on: true, min: 2 }, tags: ['dub', 'techno'] },
    { people: { on: true, min: 3 }, tags: ['dub', 'techno'] },
    { people: { on: false, min: 3 }, tags: ['dub', 'techno'] },
    { people: { on: false, min: 3 }, tags: [] },
    { people: { on: true, min: 2 }, tags: ['dub'] },
  ];
  for (const filter of [...taps, ...taps]) assert.deepEqual(filterNewReleases(held, filter), filterNewReleases(view(), filter), JSON.stringify(filter));
});

test('a minimum outside the stepper is read as its nearest end', () => {
  assert.deepEqual([0, 3.7, 40, Number.NaN].map(clampMinimum), [1, 3, 6, 1]);
  assert.deepEqual(shown({ people: { on: true, min: 0 }, tags: [] }), shown({ people: { on: true, min: 1 }, tags: [] }));
});

test('the sheet lists the first tags with a chosen one kept in view, even one the view lost, and the search finds any by name', () => {
  const counted = ['electronic', 'ambient', 'techno', 'dub', 'idm'].map((name, n) => ({ normName: name, name, count: 50 - n }));
  const names = (shown: readonly { normName: string }[]) => shown.map((tag) => tag.normName);
  assert.deepEqual(names(shownTags(counted, [], '', 2)), ['electronic', 'ambient']);
  assert.deepEqual(names(shownTags(counted, ['idm'], '', 2)), ['electronic', 'ambient', 'idm']);
  assert.deepEqual(names(shownTags(counted, [], '', Infinity)), names(counted));
  assert.deepEqual(names(shownTags(counted, ['idm'], ' TEC ', 2)), ['techno']);
  assert.deepEqual(names(shownTags(counted, [], 'zzz', 2)), []);
  assert.deepEqual(shownTags(counted, ['piano'], '', 1), [counted[0], { normName: 'piano', name: 'piano', count: 0 }]);
});

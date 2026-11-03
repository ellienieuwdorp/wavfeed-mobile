/// <reference types="node" />
/**
 * New releases' weeks under its filter: a week the filter empties drops out without turning
 * into a quiet run, the quiet runs the whole view holds stay, and a gap still stands only between two weeks.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { newReleaseRow, storyRow } from '../../test/rows';
import type { FeedTag } from '../domain/views';
import { newReleasesOf, type NewReleasesView } from '../domain/newReleases';
import { filterNewReleases, type ReleaseFilter } from '../domain/releaseFilter';
import type { FeedStoryRow } from '../domain/rows';
import { buildSectionsFromWeeks, narrowSections } from './weekSections';

const NOW = new Date('2026-10-14T12:00:00.000Z');

function released(itemId: number, day: string, tag: string, buyers: number): FeedStoryRow[] {
  const tags: FeedTag[] = [{ name: tag, normName: tag }];
  const release = { itemId, releaseDate: new Date(`${day}T00:00:00.000Z`), tags };
  return [
    newReleaseRow({ ...release, storyDate: new Date(`${day}T09:00:00.000Z`) }),
    ...Array.from({ length: buyers }, (_, fan) => storyRow({ ...release, fanId: 300 + fan, fanUsername: `fan${fan}` })),
  ];
}

/** Weeks of 5 Oct, 28 Sep and 14 Sep; the week of 21 Sep held nothing. */
const VIEW = newReleasesOf({
  stories: [...released(1, '2026-10-07', 'dub', 3), ...released(2, '2026-09-30', 'ambient', 0), ...released(3, '2026-09-16', 'dub', 2)],
  upcoming: [],
  drops: [],
  now: NOW,
});

function sectionsOf(view: NewReleasesView) {
  return buildSectionsFromWeeks(
    view.weeks.map((week) => ({ start: week.weekStart, entries: week.releases })),
    NOW,
  );
}

function shown(filter: ReleaseFilter) {
  const kept = new Set(filterNewReleases(VIEW, filter).view.weeks.flatMap((week) => week.releases.map((placed) => placed.key)));
  return narrowSections(sectionsOf(VIEW), (placed) => kept.has(placed.key)).map((section) =>
    section.kind === 'gap' ? `gap ${section.label}` : `${section.heading}: ${section.entries.map((placed) => placed.release.itemId).join(',')}`,
  );
}

test('a week the filter empties is no quiet week; the quiet week the view holds keeps its gap', () => {
  const quiet = sectionsOf(VIEW).find((section) => section.kind === 'gap');
  assert.ok(quiet?.kind === 'gap');
  const sections = shown({ people: { on: true, min: 2 }, tags: [] });
  assert.equal(sections.length, 3);
  assert.match(sections[0] ?? '', /: 1$/);
  assert.equal(sections[1], `gap ${quiet.label}`);
  assert.match(sections[2] ?? '', /: 3$/);
  // Filtering the weeks first would have read the emptied week of 28 Sep as quiet too.
  const filteredFirst = sectionsOf(filterNewReleases(VIEW, { people: { on: true, min: 2 }, tags: [] }).view).find((section) => section.kind === 'gap');
  assert.ok(filteredFirst?.kind === 'gap');
  assert.notEqual(filteredFirst.label, quiet.label);
});

test('no gap is left at either end when the weeks around it are emptied', () => {
  const sections = shown({ people: { on: true, min: 3 }, tags: [] });
  assert.equal(sections.length, 1);
  assert.match(sections[0] ?? '', /: 1$/);
  assert.deepEqual(shown({ people: { on: false, min: 2 }, tags: ['techno'] }), []);
});

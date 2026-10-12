/// <reference types="node" />
/**
 * The filter's settings on the install (task 0071, decisions 5, 8 and 9, Open 8): they survive a round trip through
 * the `kv` table, the first tap opens the sheet and later taps only toggle, a stored minimum comes back inside the
 * stepper's range, and Feed's link turns the people filter on at its minimum while the tags stay.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { openTestStore } from '../../test/nodeDb';
import { writeKv } from '../store/kv';
import {
  circlePress,
  cleared,
  FILTER_KEY,
  FIRST_SETTINGS,
  isActive,
  namedFilter,
  parseSettings,
  readFilterSettings,
  toReleaseFilter,
  withPeopleLink,
  writeFilterSettings,
  type FilterSettings,
} from './filterSettings';

const SAVED: FilterSettings = { on: true, people: { on: true, min: 3 }, tags: ['ambient', 'dub'] };

test('saved settings come back from the kv table as written, and nothing saved reads as null', async (t) => {
  const { db, close } = await openTestStore();
  t.after(close);
  assert.equal(await readFilterSettings(db), null);
  await writeFilterSettings(db, SAVED);
  assert.deepEqual(await readFilterSettings(db), SAVED);
  await writeFilterSettings(db, { ...SAVED, on: false, tags: [] });
  assert.deepEqual(await readFilterSettings(db), { ...SAVED, on: false, tags: [] });
});

test('a stored minimum outside the stepper is read inside it, and a value this code never wrote is null', async (t) => {
  const { db, close } = await openTestStore();
  t.after(close);
  await writeKv(db, FILTER_KEY, { on: true, people: { on: true, min: 40 }, tags: ['dub', 'dub', 7, ''] });
  assert.deepEqual(await readFilterSettings(db), { on: true, people: { on: true, min: 6 }, tags: ['dub'] });
  assert.equal(parseSettings({ ...SAVED, people: { on: true, min: 0 } })?.people.min, 1);
  for (const value of [null, 'on', { on: 'yes', people: { on: true, min: 2 }, tags: [] }, { on: true, people: null, tags: [] }, { on: true, people: { on: true, min: 2 } }]) {
    assert.equal(parseSettings(value), null, JSON.stringify(value));
  }
});

test('the first tap opens the sheet at people 2+ with no tags; later taps toggle with the last settings and open nothing', () => {
  assert.deepEqual(circlePress(null), { next: FIRST_SETTINGS, openSheet: true });
  assert.deepEqual(FIRST_SETTINGS, { on: true, people: { on: true, min: 2 }, tags: [] });
  assert.deepEqual(circlePress(SAVED), { next: { ...SAVED, on: false }, openSheet: false });
  assert.deepEqual(circlePress({ ...SAVED, on: false }), { next: SAVED, openSheet: false });
  const nothingChosen = { on: false, people: { on: false, min: 4 }, tags: [] };
  assert.deepEqual(circlePress(nothingChosen), { next: { ...nothingChosen, on: true }, openSheet: true });
});

test('the list is filtered only while the filter is on and chooses something', () => {
  assert.equal(isActive(null), false);
  assert.equal(isActive(SAVED), true);
  assert.equal(isActive({ ...SAVED, on: false }), false);
  assert.equal(isActive({ on: true, people: { on: false, min: 2 }, tags: [] }), false);
  assert.deepEqual(toReleaseFilter({ ...SAVED, on: false }), { people: { on: false, min: 3 }, tags: [] });
  assert.deepEqual(toReleaseFilter(SAVED), { people: { on: true, min: 3 }, tags: ['ambient', 'dub'] });
  assert.deepEqual(toReleaseFilter({ on: true, people: { on: false, min: 3 }, tags: ['dub'] }), { people: { on: false, min: 3 }, tags: ['dub'] });
});

test('Clear filters turns the filter off at the first settings', () => {
  assert.deepEqual(cleared(), { ...FIRST_SETTINGS, on: false });
  assert.equal(isActive(cleared()), false);
});

test("Feed's link turns the people filter on at 1+ and keeps the tags; no number leaves the settings alone", () => {
  assert.deepEqual(withPeopleLink(SAVED, '1'), { on: true, people: { on: true, min: 1 }, tags: ['ambient', 'dub'] });
  assert.deepEqual(withPeopleLink({ ...SAVED, on: false, people: { on: false, min: 5 } }, ['1']), { on: true, people: { on: true, min: 1 }, tags: ['ambient', 'dub'] });
  assert.deepEqual(withPeopleLink(null, '1'), { on: true, people: { on: true, min: 1 }, tags: [] });
  assert.deepEqual(withPeopleLink(null, '9'), { on: true, people: { on: true, min: 6 }, tags: [] });
  assert.equal(withPeopleLink(SAVED, undefined), SAVED);
  assert.equal(withPeopleLink(SAVED, 'many'), SAVED);
  assert.equal(withPeopleLink(null, ''), null);
});

test('the pill and the empty state name the minimum with the switch on and the chosen tags as the view spells them', () => {
  const tags = [{ normName: 'dub', name: 'Dub', count: 4 }];
  assert.deepEqual(namedFilter(SAVED, tags), { min: 3, tags: ['ambient', 'Dub'] });
  assert.deepEqual(namedFilter({ ...SAVED, people: { on: false, min: 3 } }, tags), { min: null, tags: ['ambient', 'Dub'] });
});

/// <reference types="node" />
/**
 * The filter's settings on the install (task 0071, decisions 5, 8 and 9 as amended 2026-10-14, and Open 8):
 * they survive a round trip through the `kv` table, a value saved while the filter had its own switch reads as nothing
 * chosen when that switch was off, a stored minimum comes back inside the stepper's range, the filter is active exactly
 * when something is chosen, and Feed's link turns the people filter on at its minimum while the tags stay.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { openTestStore } from '../../test/nodeDb';
import { writeKv } from '../store/kv';
import {
  FILTER_KEY,
  isActive,
  namedFilter,
  NOTHING_CHOSEN,
  parseSettings,
  readFilterSettings,
  toReleaseFilter,
  withPeopleLink,
  writeFilterSettings,
  type FilterSettings,
} from './filterSettings';

const SAVED: FilterSettings = { people: { on: true, min: 3 }, tags: ['ambient', 'dub'] };

test('saved settings come back from the kv table as written, and nothing saved reads as null', async (t) => {
  const { db, close } = await openTestStore();
  t.after(close);
  assert.equal(await readFilterSettings(db), null);
  await writeFilterSettings(db, SAVED);
  assert.deepEqual(await readFilterSettings(db), SAVED);
  await writeFilterSettings(db, NOTHING_CHOSEN);
  assert.deepEqual(await readFilterSettings(db), NOTHING_CHOSEN);
});

test('settings saved with the old on switch read as they applied: off is nothing chosen, on keeps its choices', async (t) => {
  const { db, close } = await openTestStore();
  t.after(close);
  await writeKv(db, FILTER_KEY, { on: false, people: { on: true, min: 4 }, tags: ['dub'] });
  assert.deepEqual(await readFilterSettings(db), { people: { on: false, min: 4 }, tags: [] });
  await writeKv(db, FILTER_KEY, { on: true, people: { on: true, min: 4 }, tags: ['dub'] });
  assert.deepEqual(await readFilterSettings(db), { people: { on: true, min: 4 }, tags: ['dub'] });
});

test('a stored minimum outside the stepper is read inside it, and a value this code never wrote is null', async (t) => {
  const { db, close } = await openTestStore();
  t.after(close);
  await writeKv(db, FILTER_KEY, { people: { on: true, min: 40 }, tags: ['dub', 'dub', 7, ''] });
  assert.deepEqual(await readFilterSettings(db), { people: { on: true, min: 6 }, tags: ['dub'] });
  assert.equal(parseSettings({ ...SAVED, people: { on: true, min: 0 } })?.people.min, 1);
  for (const value of [null, 'on', { on: 'yes', people: { on: true, min: 2 }, tags: [] }, { people: null, tags: [] }, { people: { on: true, min: 2 } }]) {
    assert.equal(parseSettings(value), null, JSON.stringify(value));
  }
});

test('the filter is active exactly when the people switch is on or a tag is chosen, and nothing is chosen at first', () => {
  assert.equal(isActive(null), false);
  assert.equal(isActive(NOTHING_CHOSEN), false);
  assert.deepEqual(NOTHING_CHOSEN, { people: { on: false, min: 2 }, tags: [] });
  assert.equal(isActive({ people: { on: true, min: 3 }, tags: [] }), true);
  assert.equal(isActive({ people: { on: false, min: 3 }, tags: ['dub'] }), true);
  assert.deepEqual(toReleaseFilter(null), NOTHING_CHOSEN);
  assert.deepEqual(toReleaseFilter({ people: { on: true, min: 9 }, tags: ['dub'] }), { people: { on: true, min: 6 }, tags: ['dub'] });
});

test("Feed's link turns the people filter on at 1+ and keeps the tags; no number leaves the settings alone", () => {
  assert.deepEqual(withPeopleLink(SAVED, '1'), { people: { on: true, min: 1 }, tags: ['ambient', 'dub'] });
  assert.deepEqual(withPeopleLink({ ...SAVED, people: { on: false, min: 5 } }, ['1']), { people: { on: true, min: 1 }, tags: ['ambient', 'dub'] });
  assert.deepEqual(withPeopleLink(null, '1'), { people: { on: true, min: 1 }, tags: [] });
  assert.deepEqual(withPeopleLink(null, '9'), { people: { on: true, min: 6 }, tags: [] });
  assert.equal(withPeopleLink(SAVED, undefined), SAVED);
  assert.equal(withPeopleLink(SAVED, 'many'), SAVED);
  assert.equal(withPeopleLink(null, ''), null);
});

test('the pill and the empty state name the minimum with the switch on and the chosen tags as the view spells them', () => {
  const tags = [{ normName: 'dub', name: 'Dub', count: 4 }];
  assert.deepEqual(namedFilter(SAVED, tags), { min: 3, tags: ['ambient', 'Dub'] });
  assert.deepEqual(namedFilter({ ...SAVED, people: { on: false, min: 3 } }, tags), { min: null, tags: ['ambient', 'Dub'] });
});

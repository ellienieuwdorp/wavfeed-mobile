/// <reference types="node" />
/**
 * The catch-up's words for how far back the first walk has reached and its one-line form (task 0040), the count an
 * Upcoming card and a Drop row state, as words and as the badge (task 0041, decision 9; task 0071, decision 12), the
 * release day a Drop row and a card name (task 0041, decision 10; task 0071, decision 14), and the line under the
 * player sheet's title.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { backTo, catchUpHeader, copy, countedHeader, onDayPhrase, outOnPhrase, sheetSubtitle, soFar, tracksOutPhrase, tracksOutBadge } from './copy';

const at = (iso: string): number => Date.parse(iso) / 1000;

test('the reach names the month and year the phone is in, as ADR-0011 reads dates', () => {
  const zone = process.env.TZ;
  try {
    // Node reads TZ again on assignment. The same instant is still September in Pago Pago (UTC-11) and already
    // October in Kiritimati (UTC+14).
    process.env.TZ = 'Pacific/Pago_Pago';
    assert.equal(backTo(at('2021-10-01T05:00:00Z')), 'back to September 2021');
    process.env.TZ = 'Pacific/Kiritimati';
    assert.equal(backTo(at('2021-10-01T05:00:00Z')), 'back to October 2021');
    assert.equal(backTo(at('2021-12-31T12:00:00Z')), 'back to January 2022');
  } finally {
    if (zone === undefined) delete process.env.TZ;
    else process.env.TZ = zone;
  }
});

test('while something plays, the catch-up reads as one line under the large title (task 0040, decision 6)', () => {
  assert.equal(catchUpHeader(soFar(2960), 'back to June 2026'), '2,960 so far, back to June 2026');
  assert.equal(catchUpHeader('getting set up', null), 'Getting set up');
});

test('the count shows once a Track plays and the total is known, plural by the total, the badge when the words do', () => {
  const shown = [[1, 4, '1 of 4 tracks', '1/4'], [2, 4, '2 of 4 tracks', '2/4'], [1, 1, '1 of 1 track', '1/1'], [6, 6, '6 of 6 tracks', '6/6']] as const;
  for (const [out, total, words, badge] of shown) assert.deepEqual([tracksOutPhrase(out, total), tracksOutBadge(out, total)], [words, badge]);
  for (const [out, total] of [[0, 4], [1, null], [null, 4], [3, 2]] as const) assert.deepEqual([tracksOutPhrase(out, total), tracksOutBadge(out, total)], [null, null]);
});

test('an Upcoming card draws the release day with its month and no weekday, which only the label says', () => {
  const now = new Date(2026, 9, 5, 12);
  const on = new Date(2026, 9, 13);
  assert.deepEqual([onDayPhrase(on, now), outOnPhrase(on, now)], ['13 Oct', 'out Tue 13 Oct']);
  assert.deepEqual([onDayPhrase(new Date(2026, 9, 5), now), outOnPhrase(new Date(2026, 9, 5), now)], ['Today', 'out today']);
});

test('the player names the Release under the Track only when the title line does not (finding VIS-17)', () => {
  assert.equal(sheetSubtitle('Meridian Radio', 'Sun Signals Low', 'Sun Signals Low'), 'Meridian Radio');
  assert.equal(sheetSubtitle('Meridian Radio', 'Sun Signals Low', 'sun signals low '), 'Meridian Radio');
  assert.equal(sheetSubtitle('Meridian Radio', 'Sun Signals Low', null), 'Meridian Radio');
  assert.equal(sheetSubtitle('Meridian Radio', 'Sun Signals Low', 'Tidewater'), 'Meridian Radio · Sun Signals Low');
});

test("a Drop out this month still names the month under the last month's week (finding VIS-6)", () => {
  // 1 Oct 2026: the Drop sits under "Last week · Mon 21 – Sun 27 Sep", and its Release is out on Tue 13 Oct.
  const now = new Date(2026, 9, 1, 12);
  assert.equal(outOnPhrase(new Date(2026, 9, 13), now), 'out Tue 13 Oct');
  assert.equal(outOnPhrase(new Date(2027, 0, 8), now), 'out Fri 8 Jan 2027');
});

test("New releases' header counts the view, and the filter's lines name only what is chosen (task 0071, decisions 6, 7 and 9)", () => {
  assert.equal(countedHeader(310, 'Updated 12 min ago'), '310 releases · updated 12 min ago');
  assert.equal(countedHeader(1, null), '1 release');
  assert.equal(countedHeader(1204, 'Updated just now'), '1,204 releases · updated just now');
  const f = copy.filter;
  assert.equal(f.filteredBy(2, ['ambient', 'dub']), 'Filtered by 2+ you follow · ambient, dub');
  assert.equal(f.filteredBy(1, []), 'Filtered by 1+ you follow');
  assert.equal(f.filteredBy(null, ['dub']), 'Filtered by dub');
  assert.equal(f.count(14), '14 releases');
  assert.equal(f.search(34), 'Search 34 tags');
  assert.equal(f.showAll(34), 'Show all 34');
  assert.equal(f.minimum(1), 'At least 1 person you follow');
  assert.equal(f.minimum(2), 'At least 2 people you follow');
  assert.deepEqual([f.peopleWord(1), f.peopleWord(2)], ['person', 'people']);
  assert.deepEqual([f.button(true), f.button(false)], ['Filters, active', 'Filters, none active']);
  assert.equal(f.nothingNamed(5, ['idm', 'piano']), 'Nothing tagged idm or piano that 5 people you follow bought.');
  assert.equal(f.nothingNamed(1, []), 'Nothing that someone you follow bought.');
  assert.equal(f.nothingNamed(null, ['ambient', 'dub', 'idm']), 'Nothing tagged ambient, dub or idm.');
});

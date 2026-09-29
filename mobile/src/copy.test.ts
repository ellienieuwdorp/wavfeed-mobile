/// <reference types="node" />
/**
 * The catch-up strip's words for how far back the first walk has reached (task 0040), the count an Upcoming card and a
 * Drop row state, and the release day a Drop row names (task 0041, decisions 9 and 10).
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { backTo, outOnPhrase, tracksOutPhrase } from './copy';

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

test('the count shows once a Track plays and the total is known, plural by the total', () => {
  assert.deepEqual(
    [tracksOutPhrase(1, 4), tracksOutPhrase(2, 4), tracksOutPhrase(1, 1), tracksOutPhrase(6, 6)],
    ['1 of 4 tracks', '2 of 4 tracks', '1 of 1 track', '6 of 6 tracks'],
  );
  assert.deepEqual([tracksOutPhrase(0, 4), tracksOutPhrase(1, null), tracksOutPhrase(null, 4), tracksOutPhrase(3, 2)], [null, null, null, null]);
});

test("a Drop row names the release day in the day label's form", () => {
  const now = new Date(2026, 8, 29, 12);
  assert.equal(outOnPhrase(new Date(2026, 9, 13), now), 'out Tue 13 Oct');
  assert.equal(outOnPhrase(new Date(2026, 8, 29), now), 'out today');
});

/// <reference types="node" />
/** The catch-up strip's words for how far back the first walk has reached (task 0040). */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { backTo } from './copy';

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

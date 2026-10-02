/** Which store builds an update from a tree reaches (scripts/fingerprint.mjs). */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { compare } from './fingerprint.mjs';

const record = { ios: { build: 5, fingerprint: 'a'.repeat(40) }, android: { build: 5, fingerprint: 'b'.repeat(40) } };

test("a platform is reached only while its fingerprint is the store build's", () => {
  const results = compare(record, { ios: 'a'.repeat(40), android: 'c'.repeat(40) });
  assert.deepEqual(results, [
    { platform: 'ios', build: 5, reached: true },
    { platform: 'android', build: 5, reached: false },
  ]);
});

test('a platform with no store build recorded is never reached', () => {
  assert.deepEqual(compare({}, { ios: 'a'.repeat(40), android: 'b'.repeat(40) }).map((r) => r.reached), [false, false]);
});

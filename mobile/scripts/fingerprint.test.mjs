/** Which builds an update from a tree reaches (scripts/fingerprint.mjs, from the release tags). */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { compare } from './fingerprint.mjs';
import { entryOf, tagMessage } from './ledger.mjs';

const tag = (name, runtime) => entryOf(name, 'c0ffee', tagMessage('x', { Runtime: runtime }), '');
const A = 'a'.repeat(40);
const B = 'b'.repeat(40);

test("a distribution is reached only while its newest build's fingerprint is the tree's", () => {
  const entries = [tag('ios/build-4', B), tag('ios/build-8', A), tag('android/build-7', B), tag('apk/build-3', A)];
  assert.deepEqual(compare(entries, { ios: A, android: B }), [
    { distribution: 'testflight', platform: 'ios', build: 8, reached: true },
    { distribution: 'play', platform: 'android', build: 7, reached: true },
    { distribution: 'apk', platform: 'android', build: 3, reached: false },
  ]);
});

test('a distribution with no tagged build is never reached', () => {
  assert.deepEqual(compare([], { ios: A, android: B }).map((r) => r.reached), [false, false, false]);
});

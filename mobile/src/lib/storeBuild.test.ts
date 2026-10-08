/// <reference types="node" />
/** When only the store can bring an install up to date (task 0064, decision 1). */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { storeOnlyBuild, type Installed } from './storeBuild';

const OLD = 'a'.repeat(40);
const NEW = 'b'.repeat(40);
const ios7: Installed = { platform: 'ios', build: '7', runtime: OLD };

test('a newer store build with other native code is one only the store delivers', () => {
  assert.equal(storeOnlyBuild({ ios: { build: 8, fingerprint: NEW } }, ios7), 8);
});

test('a newer store build with the same native code is left to an update', () => {
  assert.equal(storeOnlyBuild({ ios: { build: 8, fingerprint: OLD } }, ios7), null);
});

test('the store build this install is, or an older one, names nothing', () => {
  assert.equal(storeOnlyBuild({ ios: { build: 7, fingerprint: NEW } }, ios7), null);
  assert.equal(storeOnlyBuild({ ios: { build: 6, fingerprint: NEW } }, ios7), null);
});

test("the other platform's build says nothing about this one", () => {
  assert.equal(storeOnlyBuild({ android: { build: 9, fingerprint: NEW } }, ios7), null);
});

test('a malformed answer or an install without facts names nothing', () => {
  for (const answer of [null, 'x', [], { ios: null }, { ios: { build: '8', fingerprint: NEW } }, { ios: { build: 8, fingerprint: 'nope' } }]) {
    assert.equal(storeOnlyBuild(answer, ios7), null);
  }
  assert.equal(storeOnlyBuild({ ios: { build: 8, fingerprint: NEW } }, { ...ios7, build: null }), null);
  assert.equal(storeOnlyBuild({ ios: { build: 8, fingerprint: NEW } }, { ...ios7, runtime: null }), null);
});

/// <reference types="node" />
/** When only the store can bring an install up to date (task 0064, decision 1). */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { verdictOf, type Installed } from './storeBuild';

const OLD = 'a'.repeat(40);
const NEW = 'b'.repeat(40);
const ios7: Installed = { platform: 'ios', build: '7', runtime: OLD };

test('a newer store build with other native code is available', () => {
  assert.deepEqual(verdictOf({ ios: { build: 8, fingerprint: NEW } }, ios7), { kind: 'available', build: 8 });
});

test('a newer store build with the same native code is left to an update', () => {
  assert.deepEqual(verdictOf({ ios: { build: 8, fingerprint: OLD } }, ios7), { kind: 'none' });
});

test('the store build this install is, or an older one, shows nothing', () => {
  assert.deepEqual(verdictOf({ ios: { build: 7, fingerprint: NEW } }, ios7), { kind: 'none' });
  assert.deepEqual(verdictOf({ ios: { build: 6, fingerprint: NEW } }, ios7), { kind: 'none' });
});

test('a build below the floor is required, even where an update could reach it', () => {
  assert.deepEqual(verdictOf({ ios: { build: 9, fingerprint: OLD, required: 8 } }, ios7), { kind: 'required', build: 9 });
  assert.deepEqual(verdictOf({ ios: { build: 9, fingerprint: NEW, required: 7 } }, ios7), { kind: 'available', build: 9 });
});

test('the other platform\'s build says nothing about this one', () => {
  assert.deepEqual(verdictOf({ android: { build: 9, fingerprint: NEW } }, ios7), { kind: 'none' });
});

test('a malformed answer or an install without facts shows nothing', () => {
  for (const answer of [null, 'x', [], { ios: null }, { ios: { build: '8', fingerprint: NEW } }, { ios: { build: 8, fingerprint: 'nope' } }]) {
    assert.deepEqual(verdictOf(answer, ios7), { kind: 'none' });
  }
  assert.deepEqual(verdictOf({ ios: { build: 8, fingerprint: NEW } }, { ...ios7, build: null }), { kind: 'none' });
  assert.deepEqual(verdictOf({ ios: { build: 8, fingerprint: NEW } }, { ...ios7, runtime: null }), { kind: 'none' });
});

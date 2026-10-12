/// <reference types="node" />
/** The row swipe's rules (task 0071, decision 15): which press it makes, where the row goes, and what Undo sends. */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { swipeAt, swipeVerb, undoOf } from './swipe';

test('a swipe adds what is off the wishlist, removes what is on it, and is off while membership is unknown', () => {
  assert.equal(swipeVerb({ known: true, on: false }), 'add');
  assert.equal(swipeVerb({ known: true, on: true }), 'remove');
  assert.equal(swipeVerb({ known: false }), null);
});

test('Undo makes the opposite press', () => {
  assert.equal(undoOf('add'), 'remove');
  assert.equal(undoOf('remove'), 'add');
});

test('the row follows a rightward drag up to its width, arms past half, and a leftward drag moves nothing', () => {
  assert.deepEqual(swipeAt(-120, 400), { dx: 0, armed: false });
  assert.deepEqual(swipeAt(190, 400), { dx: 190, armed: false });
  assert.deepEqual(swipeAt(210, 400), { dx: 210, armed: true });
  assert.deepEqual(swipeAt(900, 400), { dx: 400, armed: true });
});

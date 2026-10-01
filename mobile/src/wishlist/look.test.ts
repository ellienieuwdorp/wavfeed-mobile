/**
 * The heart's states stay apart when nothing moves (DESIGN-UI section 12, review VIS-3, VIS-M5): under reduce motion a
 * heart is drawn at its rest, so a pending remove must not rest like on and a pending add must not rest like off, and
 * the outline that carries the 3:1 shape is never faded while a press travels.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { heartLook } from './look';

const on = heartLook({ known: true, wishlisted: true, pending: false });
const off = heartLook({ known: true, wishlisted: false, pending: false });
const removing = heartLook({ known: true, wishlisted: true, pending: true });
const adding = heartLook({ known: true, wishlisted: false, pending: true });

test('a pending remove at rest is not drawn as on', () => {
  assert.equal(on.fill?.rest, 1);
  assert.ok(removing.fill !== null && removing.fill.rest < 1 && removing.fill.rest > 0);
  assert.ok(removing.fill.peak < 1, 'the pulse never reaches the confirmed fill');
});

test('a pending add at rest is not drawn as off, and is not filled', () => {
  assert.equal(off.outline, 'faint');
  assert.equal(adding.outline, 'edge');
  assert.equal(adding.fill?.rest, 0);
});

test('an add and a remove on their way never draw the same fill', () => {
  assert.ok(adding.fill !== null && removing.fill !== null);
  assert.ok(adding.fill.peak < removing.fill.rest);
});

test('a heart not asked yet draws the off outline and no fill', () => {
  assert.deepEqual(heartLook({ known: false, wishlisted: false, pending: false }), off);
});

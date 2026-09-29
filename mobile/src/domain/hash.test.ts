/// <reference types="node" />
/**
 * Raw Document dedupe keys on this hash (ADR-0004), so it must be SHA-256 of the UTF-8 bytes exactly as the server's
 * `node:crypto` computes it: across the padding boundaries and for every kind of code point.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';

import { sha256Hex } from './hash';

test('sha256Hex agrees with node:crypto', () => {
  const texts = [
    '',
    'abc',
    ...[55, 56, 63, 64, 65, 119, 120, 1000].map((n) => 'x'.repeat(n)),
    'Café Tacvba, Björk, Sigur Rós',
    'emoji 🎧, CJK 音楽 and the last code point \u{10ffff}',
    'a lone surrogate \ud800 and a stray low \udc00',
  ];
  for (const text of texts) {
    assert.equal(sha256Hex(text), createHash('sha256').update(text, 'utf8').digest('hex'), JSON.stringify(text));
  }
});

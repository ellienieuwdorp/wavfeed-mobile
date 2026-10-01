/// <reference types="node" />
/**
 * Bandcamp images sized for what the screen draws (findings VIS-7, VIS-M3): each drawn edge in device pixels gets the
 * smallest square size that covers it, so nothing is upscaled on a 3x phone and nothing heavier than that is fetched.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { fanAvatarUrl, releaseArtUrl, sizedImageUrl } from './format';

const art = releaseArtUrl('3723565042') ?? '';
const face = fanAvatarUrl(4174986) ?? '';

test('art gets the smallest size that covers its drawn edge on a 3x screen', () => {
  // A row's 44pt, a quote's 56pt, a cover's 132pt and the player sheet's 390pt.
  assert.equal(sizedImageUrl(art, 44 * 3), 'https://f4.bcbits.com/img/a3723565042_7.jpg');
  assert.equal(sizedImageUrl(art, 56 * 3), 'https://f4.bcbits.com/img/a3723565042_9.jpg');
  assert.equal(sizedImageUrl(art, 132 * 3), 'https://f4.bcbits.com/img/a3723565042_16.jpg');
  assert.equal(sizedImageUrl(art, 390 * 3), 'https://f4.bcbits.com/img/a3723565042_10.jpg');
});

test('art wider than Bandcamp keeps gets its largest square size', () => {
  assert.equal(sizedImageUrl(art, 2048), 'https://f4.bcbits.com/img/a3723565042_10.jpg');
});

test("a Fan's face stops at 700px, since Bandcamp's larger Fan image is not square", () => {
  // The stack's 16pt disc and the Bought by sheet's 36pt face.
  assert.equal(sizedImageUrl(face, 16 * 3), 'https://f4.bcbits.com/img/4174986_42.jpg');
  assert.equal(sizedImageUrl(face, 36 * 3), 'https://f4.bcbits.com/img/4174986_7.jpg');
  assert.equal(sizedImageUrl(face, 1200), 'https://f4.bcbits.com/img/4174986_16.jpg');
});

test('any other address passes through as given', () => {
  for (const url of ['https://example.com/a1_16.jpg', 'https://f4.bcbits.com/img/a1_16.png', 'not a url']) {
    assert.equal(sizedImageUrl(url, 300), url);
  }
});

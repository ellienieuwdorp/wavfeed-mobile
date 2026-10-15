/// <reference types="node" />
/** What each heart in the player sheet wishlists and names (task 0071, decision 4 as amended 2026-10-15). */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { wishlistCopy } from './copy';
import { releaseHeart, trackHeart } from './target';

const album = { itemType: 'album', itemId: '111', title: 'Blue Hour' } as const;

test('the art heart wishlists an album as the album, never the Track playing in it', () => {
  const heart = releaseHeart(album);
  assert.deepEqual(heart.target, { itemType: 'a', itemId: '111', release: { itemType: 'a', itemId: '111' } });
  assert.equal(wishlistCopy.action(heart.name, false), 'Add the album Blue Hour to your Bandcamp wishlist');
});

test('the art heart wishlists a lone Track Release as that Track, named by its title', () => {
  const heart = releaseHeart({ itemType: 'track', itemId: '222', title: 'Tidal' });
  assert.deepEqual(heart.target, { itemType: 't', itemId: '222', release: { itemType: 't', itemId: '222' } });
  assert.equal(wishlistCopy.action(heart.name, true), 'Remove Tidal from your Bandcamp wishlist');
});

test("a tracklist row's heart wishlists its own Track, its write naming the album it is on", () => {
  const heart = trackHeart(album, { trackId: '333', title: 'Low Tide' });
  assert.deepEqual(heart.target, { itemType: 't', itemId: '333', release: { itemType: 'a', itemId: '111' } });
  assert.equal(heart.name, 'Low Tide');
});

test("an album's title Track and the album read apart, so a screen reader tells their hearts apart", () => {
  const art = releaseHeart(album);
  const row = trackHeart(album, { trackId: '333', title: 'Blue Hour' });
  assert.notEqual(wishlistCopy.action(art.name, false), wishlistCopy.action(row.name, false));
  assert.notEqual(wishlistCopy.unknown(art.name), wishlistCopy.unknown(row.name));
});

/// <reference types="node" />
/** What each heart in the player sheet wishlists (task 0071, the author's request of 2026-10-15). */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { heartTarget } from './target';

test("the art heart wishlists an album as the album, never the Track playing in it", () => {
  assert.deepEqual(heartTarget('album', '111'), { itemType: 'a', itemId: '111', release: { itemType: 'a', itemId: '111' } });
});

test('the art heart wishlists a lone Track Release as that Track', () => {
  assert.deepEqual(heartTarget('track', '222'), { itemType: 't', itemId: '222', release: { itemType: 't', itemId: '222' } });
});

test("a tracklist row's heart wishlists its own Track, its write naming the album it is on", () => {
  assert.deepEqual(heartTarget('album', '111', '333'), { itemType: 't', itemId: '333', release: { itemType: 'a', itemId: '111' } });
});

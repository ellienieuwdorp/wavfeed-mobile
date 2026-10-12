/// <reference types="node" />
/**
 * A release page's `data-tralbum` blob, where a Release reached only through purchases gets its date (ADR-0011). The
 * dates are the risk: Bandcamp puts one in two places depending on whether the page is an album or a track inside
 * one, leaves it null often, and writes packed numbers like 20260805 that are not dates the parser may read. Ported
 * from the server's suite (task 0036).
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  bandBlob,
  ITEM_ID,
  PREORDER_ITEM_ID,
  PREORDER_URL,
  preorderTrackId,
  preorderTrackPageBlob,
  phonePreorderTralbumBlob,
  preorderTralbumBlob,
  releasePagePayload,
  tralbumBlob,
} from '../../test/fixtures';
import { parseReleasePage, ReleasePagePayloadError } from './parseReleasePage';

describe('parseReleasePage', () => {
  test('reads the Release key, the date, and how many of its Tracks play', () => {
    assert.deepEqual(parseReleasePage(releasePagePayload()), {
      itemType: 'a',
      itemId: ITEM_ID,
      releaseDate: new Date('2026-08-05T00:00:00Z'),
      isPreorder: false,
      numStreamableTracks: 2,
      numTracks: 3,
      publishedAt: new Date('2026-03-31T19:43:06Z'),
      modifiedAt: new Date('2026-03-31T19:43:06Z'),
      album: null,
    });
  });

  test('reads the page a phone is served: the album\'s release day, 1 of 4, and no modified moment', () => {
    const parsed = parseReleasePage(releasePagePayload({ itemId: PREORDER_ITEM_ID, tralbum: phonePreorderTralbumBlob() }));

    assert.deepEqual(parsed, {
      itemType: 'a',
      itemId: PREORDER_ITEM_ID,
      releaseDate: new Date('2026-10-13T00:00:00Z'),
      isPreorder: true,
      numStreamableTracks: 1,
      numTracks: 4,
      publishedAt: new Date('2026-09-29T09:12:40Z'),
      modifiedAt: null,
      album: null,
    });
  });

  test('counts a Track as playing only when the page hands over its file (task 0041)', () => {
    // Every Track of the pre-order says `streaming: 1`; one has a file.
    const parsed = parseReleasePage(releasePagePayload({ itemId: PREORDER_ITEM_ID, tralbum: preorderTralbumBlob() }));

    assert.deepEqual(parsed, {
      itemType: 'a',
      itemId: PREORDER_ITEM_ID,
      releaseDate: new Date('2026-10-13T00:00:00Z'),
      isPreorder: true,
      numStreamableTracks: 1,
      numTracks: 4,
      publishedAt: new Date('2026-09-29T09:12:40Z'),
      modifiedAt: new Date('2026-09-29T09:12:40Z'),
      album: null,
    });
  });

  test("reads a Track page's album, its edit moment, and its album's day and address (tasks 0041 and 0067)", () => {
    const trackId = preorderTrackId(3);
    const parsed = parseReleasePage(
      releasePagePayload({ itemType: 't', itemId: trackId, tralbum: preorderTrackPageBlob(3, '06 Oct 2026 17:02:11 GMT') }),
    );

    assert.deepEqual(parsed, {
      itemType: 't',
      itemId: trackId,
      releaseDate: new Date('2026-10-13T00:00:00Z'),
      isPreorder: null,
      numStreamableTracks: 1,
      numTracks: 1,
      publishedAt: new Date('2026-09-29T09:12:40Z'),
      modifiedAt: new Date('2026-10-06T17:02:11Z'),
      album: { itemId: PREORDER_ITEM_ID, url: PREORDER_URL, releaseDate: new Date('2026-10-13T00:00:00Z'), isPreorder: true },
    });
  });

  test('takes the Release key the walk wrote down over the blob', () => {
    // The walk knew which row it went looking for.
    const parsed = parseReleasePage(
      releasePagePayload({ itemType: 't', itemId: 55501122, tralbum: tralbumBlob({ id: 999, item_type: 'album' }) }),
    );

    assert.deepEqual([parsed.itemType, parsed.itemId], ['t', 55501122]);
  });

  test("falls back to the blob's own item type and id when the key is absent", () => {
    const parsed = parseReleasePage({ itemUrl: 'https://x.bandcamp.com/album/y', tralbum: tralbumBlob() });

    // "album" and "track" in the blob, "a" and "t" in the schema.
    assert.deepEqual([parsed.itemType, parsed.itemId], ['a', ITEM_ID]);
  });

  test("falls back to the album's date for a track that has none of its own", () => {
    const track = tralbumBlob({
      item_type: 'track',
      current: { id: 55501122, type: 'track', release_date: null },
      album_release_date: '28 Jul 2023 00:00:00 GMT',
      is_preorder: undefined,
    });

    const parsed = parseReleasePage(releasePagePayload({ itemType: 't', tralbum: track }));

    assert.deepEqual(parsed.releaseDate, new Date('2023-07-28T00:00:00Z'));
    // A track page carries `album_is_preorder`, which is about its album.
    assert.equal(parsed.isPreorder, null);
  });

  test('leaves the date null when the page states none, and does not borrow publish_date', () => {
    const undated = tralbumBlob({
      current: { id: ITEM_ID, type: 'album', release_date: null, publish_date: '05 Aug 2026 00:00:00 GMT' },
      album_release_date: null,
    });

    assert.equal(parseReleasePage(releasePagePayload({ tralbum: undated })).releaseDate, null);
  });

  test('treats a date it cannot read as absent', () => {
    const nonsense = tralbumBlob({
      current: { id: ITEM_ID, type: 'album', release_date: 'sometime last spring' },
      album_release_date: 20260805,
    });

    assert.equal(parseReleasePage(releasePagePayload({ tralbum: nonsense })).releaseDate, null);
  });

  test('counts no Tracks when the blob carries no track list', () => {
    const parsed = parseReleasePage(releasePagePayload({ tralbum: tralbumBlob({ trackinfo: null }) }));

    assert.deepEqual([parsed.numStreamableTracks, parsed.numTracks], [null, null]);
  });

  test('drops a track list entry that is a list, which a pre-order would otherwise count as a Track not out', () => {
    const blob = preorderTralbumBlob();
    const tralbum = { ...blob, trackinfo: [...(blob.trackinfo as unknown[]), ['Low Tide', 314.52]] };
    const parsed = parseReleasePage(releasePagePayload({ itemId: PREORDER_ITEM_ID, tralbum }));

    assert.deepEqual([parsed.numStreamableTracks, parsed.numTracks], [1, 4]);
  });

  test('refuses a payload that is not a release page, or a page that names no Release', () => {
    const payloads: readonly unknown[] = [
      undefined,
      { stories: { entries: [] } },
      { itemType: 'a', itemId: ITEM_ID, tralbum: null },
      { itemUrl: 'https://x.bandcamp.com/album/y', band: bandBlob() },
      { tralbum: { current: {} } },
    ];
    for (const payload of payloads) {
      assert.throws(() => parseReleasePage(payload), ReleasePagePayloadError, JSON.stringify(payload));
    }
  });
});

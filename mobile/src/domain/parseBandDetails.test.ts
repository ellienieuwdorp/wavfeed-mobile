/// <reference types="node" />
/**
 * A Page's discography, where an Upcoming Release comes from: a record announced ahead lands with its real date and
 * nothing invented around it, since being Upcoming needs no Story (ADR-0017); fields Bandcamp writes in more than one
 * way are read in each; and anything unreadable is counted and dropped (ADR-0004). Ported from the server's suite
 * (task 0036).
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { BAND_ID, bandDetailsPayload, discographyItem, UPCOMING_ITEM_ID, UPCOMING_URL } from '../../test/fixtures';
import { BandDetailsPayloadError, parseBandDetails } from './parseBandDetails';

const UPCOMING_AT = new Date('2026-09-14T00:00:00Z');

function parseItems(...items: unknown[]) {
  return parseBandDetails(bandDetailsPayload({ items }));
}

describe('parseBandDetails', () => {
  test('reads a pre-order still ahead of today, with its Page', () => {
    const parsed = parseBandDetails(bandDetailsPayload());

    assert.equal(parsed.bandId, BAND_ID);
    assert.deepEqual(parsed.pages, [
      {
        bandId: BAND_ID,
        name: 'Nightgraft Recordings',
        url: 'https://nightgraft.bandcamp.com',
        imageId: 40118822,
        genreId: 10,
      },
    ]);
    assert.deepEqual(parsed.releases, [
      {
        itemType: 'a',
        itemId: UPCOMING_ITEM_ID,
        bandId: BAND_ID,
        title: 'Vortex Archives',
        url: UPCOMING_URL,
        artId: 1204871,
        releaseDate: UPCOMING_AT,
        isPreorder: true,
      },
    ]);
    assert.deepEqual(parsed.skipped, { unknownStoryType: 0, unparsable: 0, missingFanInfo: 0 });
  });

  test("reads the mobile endpoint's Unix seconds as readily as the feed's date string", () => {
    const parsed = parseItems(discographyItem({ release_date: UPCOMING_AT.getTime() / 1000 }));

    assert.deepEqual(parsed.releases[0]?.releaseDate, UPCOMING_AT);
  });

  test('reads both spellings of the tralbum discriminator', () => {
    const parsed = parseItems(
      discographyItem({ item_type: 'track', item_id: 1 }),
      discographyItem({ item_type: 't', item_id: 2 }),
    );

    assert.deepEqual(parsed.releases.map((release) => release.itemType), ['t', 't']);
  });

  test("resolves a catalog path against the Page's own address", () => {
    const parsed = parseItems(discographyItem({ item_url: undefined, page_url: '/album/vortex-archives' }));

    assert.equal(parsed.releases[0]?.url, UPCOMING_URL);
  });

  test('says nothing about pre-order status when the item did not', () => {
    // A made-up `false` would erase a real `true` the feed taught us, and a future date is a different fact from
    // being buyable (CONTEXT.md: Upcoming).
    const parsed = parseItems(discographyItem({ is_preorder: undefined }));

    assert.equal(parsed.releases[0]?.isPreorder, null);
  });

  test('leaves an item with no link readable, with no link invented', () => {
    const release = parseItems(discographyItem({ item_url: undefined })).releases[0];

    assert.deepEqual([release?.itemId, release?.url], [UPCOMING_ITEM_ID, null]);
  });

  test('opens a Page for a catalog item that belongs to another band and names it', () => {
    // A label's catalog can list a record that belongs to the artist's own Page, and `releases.band_id` points at
    // `pages`, so the row has to exist.
    const parsed = parseItems(discographyItem({ band_id: 771204, band_name: 'Halfmoon Tapes' }));

    assert.deepEqual(
      parsed.pages.find((page) => page.bandId === 771204),
      { bandId: 771204, name: 'Halfmoon Tapes', url: null, imageId: null, genreId: null },
    );
    assert.equal(parsed.releases[0]?.bandId, 771204);
  });

  test('attributes an item that names no band of its own to the band we swept', () => {
    assert.equal(parseItems(discographyItem({ band_id: undefined })).releases[0]?.bandId, BAND_ID);
  });

  test('counts and drops the items it cannot key on, and keeps the rest', () => {
    const parsed = parseItems(
      discographyItem(),
      discographyItem({ item_id: undefined }),
      discographyItem({ title: undefined, item_id: 3 }),
      // Merch and subscriptions are not Releases; neither is a string.
      discographyItem({ item_type: 'p', item_id: 4 }),
      'nonsense',
    );

    assert.equal(parsed.releases.length, 1);
    assert.equal(parsed.skipped.unparsable, 4);
  });

  test('keeps one row, the later, for a record the catalog listed twice', () => {
    const parsed = parseItems(discographyItem({ title: 'Old title' }), discographyItem());

    assert.equal(parsed.releases.length, 1);
    assert.equal(parsed.releases[0]?.title, 'Vortex Archives');
  });

  test('refuses a payload that is not a band details document, or one with no discography array', () => {
    // A body with no discography throws: either Bandcamp changed or the field name is wrong, and an empty answer
    // would look like a band with nothing out.
    const payloads: readonly unknown[] = [
      { bandId: BAND_ID },
      'nonsense',
      { bandId: BAND_ID, bandDetails: { id: BAND_ID, name: 'Nightgraft' } },
    ];
    for (const payload of payloads) {
      assert.throws(() => parseBandDetails(payload), BandDetailsPayloadError, JSON.stringify(payload));
    }
  });

  test("falls back to the body's own id when the envelope names no band", () => {
    const parsed = parseBandDetails({ bandDetails: { id: BAND_ID, name: 'Nightgraft Recordings', discography: [] } });

    assert.equal(parsed.bandId, BAND_ID);
    assert.deepEqual(parsed.releases, []);
  });
});

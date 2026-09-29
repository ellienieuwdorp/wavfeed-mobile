/// <reference types="node" />
/**
 * One page of the Fan's own wishlist walk (ADR-0016): the record each heart is drawn for, and whether the page may
 * end the walk, since only a page Bandcamp said was the last may sweep. Ported from the server's suite (task 0036).
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { parseWishlistItems, WishlistItemsPayloadError } from './parseWishlistItems';

const SNAPSHOT = new Date('2026-08-28T12:00:00.000Z');

function entry(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    item_type: 'album',
    item_id: 700_000_001,
    tralbum_type: 'a',
    tralbum_id: 4_102_938_475,
    band_id: 3_820_115,
    added: '18 Aug 2026 07:28:27 GMT',
    ...overrides,
  };
}

/** The stored document; `more_available` is left off the response when `moreAvailable` is absent from the options. */
function payload(options: { items?: unknown; moreAvailable?: unknown; snapshotStartedAt?: string | null } = {}): unknown {
  const response: Record<string, unknown> = { items: options.items ?? [entry()] };
  if ('moreAvailable' in options) response.more_available = options.moreAvailable;
  const body: Record<string, unknown> = {
    url: 'https://bandcamp.com/api/fancollection/1/wishlist_items',
    request: { fan_id: 7, older_than_token: `${SNAPSHOT.getTime() / 1000}::a::`, count: 100 },
    response,
  };
  if (options.snapshotStartedAt !== null) body.snapshot_started_at = options.snapshotStartedAt ?? SNAPSHOT.toISOString();
  return body;
}

describe('parseWishlistItems', () => {
  test("reads the record's own key, not the collection entry's", () => {
    const parsed = parseWishlistItems(payload({ moreAvailable: false }));

    assert.deepEqual(parsed.items, [
      { itemType: 'a', itemId: 4_102_938_475, bandId: 3_820_115, addedAt: new Date('2026-08-18T07:28:27Z') },
    ]);
    assert.deepEqual(parsed.snapshotStartedAt, SNAPSHOT);
  });

  test("falls back to the entry's own type and id when there is no tralbum pair", () => {
    const parsed = parseWishlistItems(payload({ items: [{ item_type: 'track', item_id: 55_501_122, band_id: null }] }));

    assert.deepEqual(parsed.items, [{ itemType: 't', itemId: 55_501_122, bandId: null, addedAt: null }]);
  });

  test('drops an entry naming no Release and counts it, keeping the rest of the page', () => {
    const parsed = parseWishlistItems(payload({ items: [entry(), { item_type: 'merch', item_id: 'not a number' }] }));

    assert.equal(parsed.items.length, 1);
    assert.equal(parsed.skipped.unparsable, 1);
  });

  test('keeps one row when a page names the same record twice', () => {
    const parsed = parseWishlistItems(payload({ items: [entry(), entry({ item_id: 700_000_002 })] }));

    assert.equal(parsed.items.length, 1);
  });

  test('calls a page terminal only when Bandcamp says there is no more', () => {
    // Gifts are filtered server-side, so a page mid-walk can carry nothing and still have more behind it; sweeping on
    // it would empty every item below that cursor. An empty last page is the end of an empty wishlist.
    const cases: readonly [string, unknown[], boolean | undefined, boolean][] = [
      ['a full last page', [entry()], false, true],
      ['a full page with more', [entry()], true, false],
      ['an empty page with more', [], true, false],
      ['an empty last page', [], false, true],
      ['a page that does not say', [entry()], undefined, false],
    ];
    for (const [label, items, moreAvailable, terminal] of cases) {
      const options = moreAvailable === undefined ? { items } : { items, moreAvailable };
      assert.equal(parseWishlistItems(payload(options)).terminal, terminal, label);
    }
  });

  test('refuses a document with no response, no items array, or no snapshot start', () => {
    assert.throws(() => parseWishlistItems({ url: 'x' }), WishlistItemsPayloadError);
    assert.throws(() => parseWishlistItems(payload({ items: 'nope' })), WishlistItemsPayloadError);
    assert.throws(() => parseWishlistItems(payload({ snapshotStartedAt: null })), WishlistItemsPayloadError);
  });
});

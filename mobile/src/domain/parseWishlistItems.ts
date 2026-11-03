/**
 * The parser for a `wishlist_items` Raw Document: one page of the Fan's own wishlist, stamped with the walk's start (ADR-0016).
 */
import type { ItemType, ParsedWishlistItem, ParsedWishlistItems } from './types';
import { noSkips } from './types';
import { asRecord, asTralbumType, readDate, readId, readText } from './wire';

export class WishlistItemsPayloadError extends Error {
  override readonly name = 'WishlistItemsPayloadError';
}

/** The record (`tralbum_*`) is what a heart is drawn for; the collection entry (`item_*`) is the fallback. */
function readKey(entry: Record<string, unknown>): { readonly itemType: ItemType; readonly itemId: number } | undefined {
  const tralbumType = asTralbumType(readText(entry, 'tralbum_type'));
  const tralbumId = readId(entry, 'tralbum_id');
  if (tralbumType !== undefined && tralbumId !== undefined) return { itemType: tralbumType, itemId: tralbumId };
  const itemType = asTralbumType(readText(entry, 'item_type'));
  const itemId = readId(entry, 'item_id');
  return itemType !== undefined && itemId !== undefined ? { itemType, itemId } : undefined;
}

/**
 * Parses `{ url, snapshot_started_at, request, response }`. Only
 * `more_available: false` makes a page terminal; an empty page is not an end.
 */
export function parseWishlistItems(payload: unknown): ParsedWishlistItems {
  const root = asRecord(payload);
  const response = asRecord(root?.response);
  if (root === undefined || response === undefined) {
    throw new WishlistItemsPayloadError('payload is not a wishlist_items document: no response object in it');
  }
  const snapshotStartedAt = readDate(root, 'snapshot_started_at');
  if (snapshotStartedAt === undefined) {
    throw new WishlistItemsPayloadError('wishlist_items document carries no readable snapshot_started_at');
  }
  const entries = response.items;
  if (!Array.isArray(entries)) {
    throw new WishlistItemsPayloadError('wishlist_items response carries no items array');
  }

  const skipped = noSkips();
  const items: ParsedWishlistItem[] = [];
  const seen = new Set<string>();
  for (const raw of entries) {
    const entry = asRecord(raw);
    const key = entry === undefined ? undefined : readKey(entry);
    if (entry === undefined || key === undefined) {
      skipped.unparsable += 1;
      continue;
    }
    const dedupeKey = `${key.itemType}:${key.itemId}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    items.push({
      itemType: key.itemType,
      itemId: key.itemId,
      bandId: readId(entry, 'band_id') ?? null,
      addedAt: readDate(entry, 'added') ?? null,
    });
  }

  return { snapshotStartedAt, items, terminal: response.more_available === false, skipped };
}

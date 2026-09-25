/**
 * The parser for a `release_page` Raw Document: the `data-tralbum` blob in, the release date, pre-order state and streamable count out.
 * Ported from server/packages/projection/src/parseReleasePage.ts (task 0036).
 */
import type { ItemType, ParsedReleasePage } from './types';
import { asRecord, asTralbumType, readDate, readId, readText } from './wire';

export class ReleasePagePayloadError extends Error {
  override readonly name = 'ReleasePagePayloadError';
}

/** The Fetcher's own key wins; the tralbum's `item_type`/`id` stand in only when it is missing. */
function readIdentity(
  payload: Record<string, unknown>,
  tralbum: Record<string, unknown>,
): { readonly itemType: ItemType; readonly itemId: number } | undefined {
  const itemType = asTralbumType(readText(payload, 'itemType') ?? readText(tralbum, 'item_type'));
  const itemId = readId(payload, 'itemId') ?? readId(tralbum, 'id');
  return itemType === undefined || itemId === undefined ? undefined : { itemType, itemId };
}

function readStreamableTracks(tralbum: Record<string, unknown>): number | undefined {
  const trackinfo = tralbum.trackinfo;
  if (!Array.isArray(trackinfo)) return undefined;
  let streamable = 0;
  for (const raw of trackinfo) {
    const track = asRecord(raw);
    if (track !== undefined && track.streaming !== null && track.streaming !== undefined) streamable += 1;
  }
  return streamable;
}

/**
 * Parses `{ itemType, itemId, itemUrl, tralbum, band }`. A track's date falls
 * back to `album_release_date`; `is_preorder` is read only where the page states it.
 */
export function parseReleasePage(payload: unknown): ParsedReleasePage {
  const root = asRecord(payload);
  const tralbum = asRecord(root?.tralbum);
  if (root === undefined || tralbum === undefined) {
    throw new ReleasePagePayloadError('payload is not a release_page document: no tralbum object in it');
  }
  const identity = readIdentity(root, tralbum);
  if (identity === undefined) {
    throw new ReleasePagePayloadError('release_page document names no Release');
  }
  const current = asRecord(tralbum.current) ?? {};
  const releaseDate = readDate(current, 'release_date') ?? readDate(tralbum, 'album_release_date');
  return {
    itemType: identity.itemType,
    itemId: identity.itemId,
    releaseDate: releaseDate ?? null,
    isPreorder: typeof tralbum.is_preorder === 'boolean' ? tralbum.is_preorder : null,
    numStreamableTracks: readStreamableTracks(tralbum) ?? null,
  };
}

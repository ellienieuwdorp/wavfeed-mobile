/**
 * The parser for a `release_page` Raw Document: the `data-tralbum` blob in, the release date, pre-order state, and how
 * many Tracks play of how many there are out; with the page's publish and edit moments and, on
 * a Track page, its album, which date a Drop and open an Upcoming album; and
 * `tralbum.artist`, the credit a Release no feed entry credited takes.
 */
import { readTralbumTracks } from './tralbumTracks';
import type { ItemType, ParsedReleasePage, ParsedTrackAlbum } from './types';
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

/** A Track plays when the page hands over a file for it; `streaming` says 1 on Tracks not out yet. */
function readTrackCounts(tralbum: Record<string, unknown>): { readonly streamable: number; readonly total: number } | undefined {
  if (!Array.isArray(tralbum.trackinfo)) return undefined;
  const tracks = readTralbumTracks(tralbum);
  return { streamable: tracks.filter((track) => track.streamUrl !== null).length, total: tracks.length };
}

/** `album_url` is a path on the Track page's host, which may be a custom domain. */
function readAlbumUrl(root: Record<string, unknown>, tralbum: Record<string, unknown>): string | null {
  const path = readText(tralbum, 'album_url');
  const base = readText(root, 'itemUrl') ?? readText(tralbum, 'url');
  if (path === undefined || base === undefined) return null;
  try {
    const url = new URL(path, base);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
  } catch {
    return null;
  }
}

function readTrackAlbum(
  root: Record<string, unknown>,
  tralbum: Record<string, unknown>,
  current: Record<string, unknown>,
): ParsedTrackAlbum | null {
  const itemId = readId(current, 'album_id');
  if (itemId === undefined) return null;
  return {
    itemId,
    url: readAlbumUrl(root, tralbum),
    releaseDate: readDate(tralbum, 'album_release_date') ?? null,
    isPreorder: typeof tralbum.album_is_preorder === 'boolean' ? tralbum.album_is_preorder : null,
  };
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
  const counts = readTrackCounts(tralbum);
  return {
    itemType: identity.itemType,
    itemId: identity.itemId,
    releaseDate: releaseDate ?? null,
    isPreorder: typeof tralbum.is_preorder === 'boolean' ? tralbum.is_preorder : null,
    numStreamableTracks: counts?.streamable ?? null,
    numTracks: counts?.total ?? null,
    publishedAt: readDate(current, 'publish_date') ?? null,
    modifiedAt: readDate(current, 'mod_date') ?? null,
    album: identity.itemType === 't' ? readTrackAlbum(root, tralbum, current) : null,
    artistCredit: readText(tralbum, 'artist') ?? null,
  };
}

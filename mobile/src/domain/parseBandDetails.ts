/**
 * The parser for a `band_details` Raw Document: a Page's discography in, catalog Pages and Releases out, never Stories (ADR-0017).
 * Ported from server/packages/projection/src/parseBandDetails.ts (task 0036).
 */
import type { ParsedBandDetails, ParsedCatalogRelease, ParsedPage } from './types';
import { noSkips } from './types';
import { asRecord, asTralbumType, readDate, readId, readText } from './wire';

export class BandDetailsPayloadError extends Error {
  override readonly name = 'BandDetailsPayloadError';
}

function readRootPage(bandId: number, details: Record<string, unknown>): ParsedPage | undefined {
  const name = readText(details, 'name');
  if (name === undefined) return undefined;
  return {
    bandId,
    name,
    url: readText(details, 'bandcamp_url') ?? readText(details, 'url') ?? null,
    imageId: readId(details, 'image_id') ?? null,
    genreId: readId(details, 'genre_id') ?? null,
  };
}

function readItemPage(item: Record<string, unknown>, bandId: number): ParsedPage | undefined {
  const name = readText(item, 'band_name');
  if (name === undefined) return undefined;
  return { bandId, name, url: readText(item, 'band_url') ?? null, imageId: null, genreId: null };
}

/** `page_url` is relative to the Page's own domain, so it needs the Page's address to resolve. */
function readItemUrl(item: Record<string, unknown>, pageUrl: string | null): string | null {
  const stated = readText(item, 'item_url') ?? readText(item, 'url');
  if (stated !== undefined) return stated;
  const path = readText(item, 'page_url');
  if (path === undefined || pageUrl === null) return null;
  try {
    return new URL(path, pageUrl).toString();
  } catch {
    return null;
  }
}

/** The mobile endpoint writes Unix seconds; the shared reader stays strings-only. */
function readCatalogDate(item: Record<string, unknown>, key: string): Date | undefined {
  const value = item[key];
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return undefined;
    const parsed = new Date(value * 1000);
    return Number.isNaN(parsed.getTime()) ? undefined : parsed;
  }
  return readDate(item, key);
}

function readItem(
  item: Record<string, unknown>,
  context: { readonly bandId: number; readonly pageUrl: string | null },
): ParsedCatalogRelease | undefined {
  const itemType = asTralbumType(readText(item, 'item_type'));
  const itemId = readId(item, 'item_id') ?? readId(item, 'id');
  const title = readText(item, 'title') ?? readText(item, 'item_title');
  if (itemType === undefined || itemId === undefined || title === undefined) return undefined;
  return {
    itemType,
    itemId,
    bandId: readId(item, 'band_id') ?? context.bandId,
    title,
    url: readItemUrl(item, context.pageUrl),
    artId: readId(item, 'art_id') ?? readId(item, 'item_art_id') ?? null,
    releaseDate: readCatalogDate(item, 'release_date') ?? null,
    isPreorder: typeof item.is_preorder === 'boolean' ? item.is_preorder : null,
  };
}

/** Parses `{ bandId, bandDetails }`; a body with no discography array throws, so it is counted rather than read as empty. */
export function parseBandDetails(payload: unknown): ParsedBandDetails {
  const root = asRecord(payload);
  const details = asRecord(root?.bandDetails);
  if (root === undefined || details === undefined) {
    throw new BandDetailsPayloadError('payload is not a band_details document: no bandDetails object in it');
  }
  const bandId = readId(root, 'bandId') ?? readId(details, 'id');
  if (bandId === undefined) {
    throw new BandDetailsPayloadError('band_details document names no Page');
  }
  const items = details.discography;
  if (!Array.isArray(items)) {
    throw new BandDetailsPayloadError('band_details document carries no discography array');
  }

  const skipped = noSkips();
  const pages = new Map<number, ParsedPage>();
  const releases = new Map<string, ParsedCatalogRelease>();
  const rootPage = readRootPage(bandId, details);
  if (rootPage !== undefined) pages.set(bandId, rootPage);

  for (const entry of items) {
    const item = asRecord(entry);
    const release: ParsedCatalogRelease | undefined = item === undefined ? undefined : readItem(item, { bandId, pageUrl: rootPage?.url ?? null });
    if (item === undefined || release === undefined) {
      skipped.unparsable += 1;
      continue;
    }
    if (release.bandId !== bandId && !pages.has(release.bandId)) {
      const itemPage = readItemPage(item, release.bandId);
      if (itemPage !== undefined) pages.set(release.bandId, itemPage);
    }
    releases.set(`${release.itemType}:${release.itemId}`, release);
  }

  return { bandId, pages: [...pages.values()], releases: [...releases.values()], skipped };
}

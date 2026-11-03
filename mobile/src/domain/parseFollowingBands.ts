/**
 * The parser for a `following_bands` Raw Document: one page of a follow-list walk in, band ids out (ADR-0017).
 */
import type { MutableSkippedCounts, ParsedFollowingBands } from './types';
import { noSkips } from './types';
import { asCount, asId, asRecord, readDate, readId } from './wire';

export class FollowingBandsPayloadError extends Error {
  override readonly name = 'FollowingBandsPayloadError';
}

function readCacheEntries(cache: Record<string, unknown>, bandIds: Set<number>, skipped: MutableSkippedCounts): void {
  for (const [key, value] of Object.entries(cache)) {
    const entry = asRecord(value);
    const bandId = (entry === undefined ? undefined : readId(entry, 'band_id')) ?? asId(key);
    if (bandId === undefined) skipped.unparsable += 1;
    else bandIds.add(bandId);
  }
}

function readItemEntries(items: readonly unknown[], bandIds: Set<number>, skipped: MutableSkippedCounts): void {
  for (const value of items) {
    const entry = asRecord(value);
    const bandId = entry === undefined ? undefined : (readId(entry, 'band_id') ?? readId(entry, 'id'));
    if (bandId === undefined) skipped.unparsable += 1;
    else bandIds.add(bandId);
  }
}

/**
 * A continuation page says so with `more_available: false`; a first page ends
 * the walk when its batch already holds `item_count`. Anything unreadable is not an end.
 */
function isTerminal(followingBands: Record<string, unknown>, batchSize: number): boolean {
  if (Array.isArray(followingBands.items)) return followingBands.more_available === false;
  const sequence = asRecord(followingBands.following_bands);
  const itemCount = asCount(sequence?.item_count);
  return itemCount !== undefined && batchSize >= itemCount;
}

/** Parses `{ fanId, page, snapshotStartedAt, followingBands }` in either of its two shapes. */
export function parseFollowingBands(payload: unknown): ParsedFollowingBands {
  const root = asRecord(payload);
  const followingBands = asRecord(root?.followingBands);
  if (root === undefined || followingBands === undefined) {
    throw new FollowingBandsPayloadError('payload is not a following_bands document: no followingBands object in it');
  }
  const cache = asRecord(asRecord(followingBands.item_cache)?.following_bands);
  const items = followingBands.items;
  if (cache === undefined && !Array.isArray(items)) {
    throw new FollowingBandsPayloadError('following_bands document carries neither an item_cache batch nor an items array');
  }

  const skipped = noSkips();
  const bandIds = new Set<number>();
  if (cache !== undefined) readCacheEntries(cache, bandIds, skipped);
  if (Array.isArray(items)) readItemEntries(items, bandIds, skipped);

  return {
    fanId: readId(root, 'fanId') ?? null,
    page: readId(root, 'page') ?? null,
    snapshotStartedAt: readDate(root, 'snapshotStartedAt') ?? null,
    bandIds: [...bandIds],
    terminal: isTerminal(followingBands, bandIds.size),
    skipped,
  };
}

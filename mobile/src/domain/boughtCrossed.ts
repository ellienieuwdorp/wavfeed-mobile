/**
 * The Bought view's second mode: Releases at least `threshold` followed Fans bought, newest crossing first, release date ignored.
 * Ported from server/apps/api/src/feed/boughtCrossed.ts (task 0036); it reads the chart's `BoughtRelease` list (boughtChart.ts).
 */
import type { ApiBoughtCrossedEntry } from './apiTypes';
import { compareSortKeys, type ElementSortKey } from './assemble';
import { type BoughtRelease, boughtReleases } from './boughtChart';
import type { FeedStoryRow } from './rows';

export const CROSSED_MIN_THRESHOLD = 2;
export const CROSSED_MAX_THRESHOLD = 10;
export const CROSSED_DEFAULT_THRESHOLD = CROSSED_MIN_THRESHOLD;

export function crossedSortKey(entry: ApiBoughtCrossedEntry): ElementSortKey {
  return { sortDate: entry.crossedAt, tiebreak: `${entry.item.itemType}:${entry.item.itemId}` };
}

export function crossedListOf(releases: readonly BoughtRelease[], threshold: number): readonly ApiBoughtCrossedEntry[] {
  const entries: ApiBoughtCrossedEntry[] = [];
  for (const release of releases) {
    const crossed = release.firstPurchases[threshold - 1];
    if (crossed === undefined) continue;
    entries.push({ item: release.item, crossedAt: new Date(crossed).toISOString() });
  }
  return entries.sort((a, b) => compareSortKeys(crossedSortKey(a), crossedSortKey(b)));
}

export function buildCrossedList(rows: readonly FeedStoryRow[], threshold: number): readonly ApiBoughtCrossedEntry[] {
  return crossedListOf(boughtReleases(rows), threshold);
}

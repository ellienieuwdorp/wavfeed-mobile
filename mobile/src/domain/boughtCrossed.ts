/**
 * The Bought view's second mode: Releases at least `threshold` followed Fans bought, newest crossing first, release date ignored.
 * Ported from server/apps/api/src/feed/boughtCrossed.ts (task 0036).
 */
import type { ApiBoughtCrossedEntry } from './apiTypes';
import { buildFeedItem, compareSortKeys, type ElementSortKey, fanRef, groupByItem } from './assemble';
import type { FeedStoryRow } from './rows';

export const CROSSED_MIN_THRESHOLD = 2;
export const CROSSED_MAX_THRESHOLD = 10;
export const CROSSED_DEFAULT_THRESHOLD = CROSSED_MIN_THRESHOLD;

/** Each named Fan's first purchase, oldest first: a crossing happens once. */
function firstPurchaseTimes(itemRows: readonly FeedStoryRow[]): number[] {
  const earliest = new Map<string, number>();
  for (const row of itemRows) {
    if (row.storyType !== 'purchase') continue;
    const fan = fanRef(row);
    if (fan === null) continue;
    const time = row.storyDate.getTime();
    const known = earliest.get(fan.fanId);
    if (known === undefined || time < known) earliest.set(fan.fanId, time);
  }
  return [...earliest.values()].sort((a, b) => a - b);
}

export function crossedSortKey(entry: ApiBoughtCrossedEntry): ElementSortKey {
  return { sortDate: entry.crossedAt, tiebreak: `${entry.item.itemType}:${entry.item.itemId}` };
}

export function buildCrossedList(rows: readonly FeedStoryRow[], threshold: number): readonly ApiBoughtCrossedEntry[] {
  const entries: ApiBoughtCrossedEntry[] = [];
  for (const itemRows of groupByItem(rows).values()) {
    const crossed = firstPurchaseTimes(itemRows)[threshold - 1];
    if (crossed === undefined) continue;
    entries.push({ item: buildFeedItem(itemRows), crossedAt: new Date(crossed).toISOString() });
  }
  return entries.sort((a, b) => compareSortKeys(crossedSortKey(a), crossedSortKey(b)));
}

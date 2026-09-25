/**
 * The Bought view's weekly chart: Releases followed Fans bought, filed under the GMT Monday of the release week, ranked by distinct buyers (ADR-0011).
 * Ported from server/apps/api/src/feed/boughtChart.ts (task 0036).
 */
import type { ApiBoughtWeek, ApiFeedItem } from './apiTypes';
import { buildFeedItem, fanRef, groupByItem } from './assemble';
import type { FeedStoryRow } from './rows';

function releaseDateOf(itemRows: readonly FeedStoryRow[]): Date | null {
  for (const row of itemRows) {
    if (row.releaseDate !== null) return row.releaseDate;
  }
  return null;
}

/** The Monday of a date's week in UTC, as `2026-08-17`. */
export function weekStartOf(date: Date): string {
  const daysSinceMonday = (date.getUTCDay() + 6) % 7;
  const monday = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - daysSinceMonday));
  return monday.toISOString().slice(0, 10);
}

function latestPurchaseTime(itemRows: readonly FeedStoryRow[]): number {
  let latest = 0;
  for (const row of itemRows) {
    if (row.storyType !== 'purchase' || fanRef(row) === null) continue;
    latest = Math.max(latest, row.storyDate.getTime());
  }
  return latest;
}

type Ranked = {
  readonly item: ApiFeedItem;
  readonly latestPurchase: number;
};

function byRank(a: Ranked, b: Ranked): number {
  if (a.item.buyers.length !== b.item.buyers.length) return b.item.buyers.length - a.item.buyers.length;
  if (a.latestPurchase !== b.latestPurchase) return b.latestPurchase - a.latestPurchase;
  return a.item.itemId.localeCompare(b.item.itemId);
}

/** Eligible: a known release date and at least one named buyer. Future weeks sort first; empty weeks are absent. */
export function buildBoughtChart(rows: readonly FeedStoryRow[]): readonly ApiBoughtWeek[] {
  const byWeek = new Map<string, Ranked[]>();
  for (const itemRows of groupByItem(rows).values()) {
    const releaseDate = releaseDateOf(itemRows);
    if (releaseDate === null) continue;
    const item = buildFeedItem(itemRows);
    if (item.buyers.length === 0) continue;
    const entry: Ranked = { item, latestPurchase: latestPurchaseTime(itemRows) };
    const week = weekStartOf(releaseDate);
    const existing = byWeek.get(week);
    if (existing === undefined) byWeek.set(week, [entry]);
    else existing.push(entry);
  }
  return [...byWeek.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([weekStart, entries]) => ({ weekStart, entries: entries.sort(byRank).map((entry) => entry.item) }));
}

/**
 * The Bought view's weekly chart: Releases followed Fans bought, filed under the GMT Monday of the release week, ranked by distinct buyers (ADR-0011).
 * Ported from server/apps/api/src/feed/boughtChart.ts (task 0036). Both Bought modes judge the same `BoughtRelease` list, built once per read,
 * so a switch between them only places what is held and never regroups the Stories.
 */
import type { ApiBoughtWeek, ApiFeedItem } from './apiTypes';
import { buildFeedItem, groupByItem, hasFan } from './assemble';
import type { FeedStoryRow } from './rows';

/** A Release at least one named Fan bought, with what the chart and the crossed list rank it by. */
export type BoughtRelease = {
  readonly item: ApiFeedItem;
  readonly releaseDate: Date | null;
  readonly latestPurchase: number;
  /** Each named Fan's first purchase, oldest first: a crossing happens once. */
  readonly firstPurchases: readonly number[];
};

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

function purchaseTimes(itemRows: readonly FeedStoryRow[]): { latest: number; firsts: number[] } {
  let latest = 0;
  const earliest = new Map<number, number>();
  for (const row of itemRows) {
    if (row.storyType !== 'purchase' || !hasFan(row)) continue;
    const time = row.storyDate.getTime();
    latest = Math.max(latest, time);
    const known = earliest.get(row.fanId);
    if (known === undefined || time < known) earliest.set(row.fanId, time);
  }
  return { latest, firsts: [...earliest.values()].sort((a, b) => a - b) };
}

/** Every Release with a named purchase, in the order its first Story arrived. */
export function boughtReleases(rows: readonly FeedStoryRow[]): readonly BoughtRelease[] {
  const held: BoughtRelease[] = [];
  for (const itemRows of groupByItem(rows).values()) {
    const { latest, firsts } = purchaseTimes(itemRows);
    if (firsts.length === 0) continue;
    held.push({ item: buildFeedItem(itemRows), releaseDate: releaseDateOf(itemRows), latestPurchase: latest, firstPurchases: firsts });
  }
  return held;
}

function byRank(a: BoughtRelease, b: BoughtRelease): number {
  if (a.item.buyers.length !== b.item.buyers.length) return b.item.buyers.length - a.item.buyers.length;
  if (a.latestPurchase !== b.latestPurchase) return b.latestPurchase - a.latestPurchase;
  return a.item.itemId.localeCompare(b.item.itemId);
}

/** Eligible: a known release date and at least one named buyer. Future weeks sort first; empty weeks are absent. */
export function boughtChartOf(releases: readonly BoughtRelease[]): readonly ApiBoughtWeek[] {
  const byWeek = new Map<string, BoughtRelease[]>();
  for (const release of releases) {
    if (release.releaseDate === null) continue;
    const week = weekStartOf(release.releaseDate);
    const existing = byWeek.get(week);
    if (existing === undefined) byWeek.set(week, [release]);
    else existing.push(release);
  }
  // Week keys are distinct ISO days, so code unit order is date order.
  return [...byWeek.entries()]
    .sort(([a], [b]) => (a < b ? 1 : -1))
    .map(([weekStart, entries]) => ({ weekStart, entries: entries.sort(byRank).map((entry) => entry.item) }));
}

export function buildBoughtChart(rows: readonly FeedStoryRow[]): readonly ApiBoughtWeek[] {
  return boughtChartOf(boughtReleases(rows));
}

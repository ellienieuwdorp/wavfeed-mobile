/**
 * The Curated Feed's three modules over the same Stories, with no Burst collapse; the window is measured from the newest Story held, not the clock.
 * Ported from server/apps/api/src/feed/curate.ts (task 0036).
 */
import type { ApiCuratedQuote, ApiCuratedResponse, ApiFanRef, ApiFeedItem } from './apiTypes';
import { buildFeedItem, byStoryDateDesc, fanRef, groupByItem, itemKey } from './assemble';
import type { FeedStoryRow } from './rows';

export const CURATED_WINDOW_DAYS = 14;
export const CURATED_MIN_BUYERS = 2;
export const CURATED_BOUGHT_MAX = 8;
export const CURATED_NEW_MAX = 5;
export const CURATED_QUOTES_MAX = 6;

const DAY_MS = 24 * 60 * 60_000;

function newestStoryTime(rows: readonly FeedStoryRow[]): number {
  let newest = 0;
  for (const row of rows) newest = Math.max(newest, row.storyDate.getTime());
  return newest;
}

type BoughtCandidate = {
  readonly item: ApiFeedItem;
  readonly buyerCount: number;
  readonly latestPurchase: number;
};

function windowedBuyers(itemRows: readonly FeedStoryRow[], since: number): readonly ApiFanRef[] {
  const windowed = itemRows
    .filter((row) => row.storyType === 'purchase' && row.fanId !== null && row.storyDate.getTime() >= since)
    .sort(byStoryDateDesc);
  const buyers: ApiFanRef[] = [];
  const named = new Set<string>();
  for (const row of windowed) {
    const fan = fanRef(row);
    if (fan === null || named.has(fan.fanId)) continue;
    named.add(fan.fanId);
    buyers.push(fan);
  }
  return buyers;
}

function latestWindowedPurchase(itemRows: readonly FeedStoryRow[], since: number): Date | null {
  let latest: Date | null = null;
  for (const row of itemRows) {
    if (row.storyType !== 'purchase' || row.fanId === null || row.storyDate.getTime() < since) continue;
    if (latest === null || row.storyDate.getTime() > latest.getTime()) latest = row.storyDate;
  }
  return latest;
}

/** The count, avatars and time phrase are narrowed to the window the module's sentence claims. */
function boughtByFollowed(rows: readonly FeedStoryRow[]): readonly ApiFeedItem[] {
  const since = newestStoryTime(rows) - CURATED_WINDOW_DAYS * DAY_MS;
  const candidates: BoughtCandidate[] = [];
  for (const itemRows of groupByItem(rows).values()) {
    const buyers = windowedBuyers(itemRows, since);
    if (buyers.length < CURATED_MIN_BUYERS) continue;
    const latest = latestWindowedPurchase(itemRows, since);
    if (latest === null) continue;
    const item: ApiFeedItem = { ...buildFeedItem(itemRows), buyers, latestStoryDate: latest.toISOString() };
    candidates.push({ item, buyerCount: buyers.length, latestPurchase: latest.getTime() });
  }
  return candidates
    .sort((a, b) => {
      if (a.buyerCount !== b.buyerCount) return b.buyerCount - a.buyerCount;
      if (a.latestPurchase !== b.latestPurchase) return b.latestPurchase - a.latestPurchase;
      return a.item.itemId.localeCompare(b.item.itemId);
    })
    .slice(0, CURATED_BOUGHT_MAX)
    .map((candidate) => candidate.item);
}

/** Ranked by the announcement's own date, never the release date, so pre-orders cannot hold every cover. */
function newFromPages(rows: readonly FeedStoryRow[]): readonly ApiFeedItem[] {
  const candidates: { item: ApiFeedItem; at: number }[] = [];
  for (const itemRows of groupByItem(rows).values()) {
    let at = 0;
    let announced = false;
    for (const row of itemRows) {
      if (row.storyType !== 'new_release') continue;
      announced = true;
      at = Math.max(at, row.storyDate.getTime());
    }
    if (announced) candidates.push({ item: buildFeedItem(itemRows), at });
  }
  return candidates
    .sort((a, b) => b.at - a.at || a.item.itemId.localeCompare(b.item.itemId))
    .slice(0, CURATED_NEW_MAX)
    .map((candidate) => candidate.item);
}

function inTheirOwnWords(rows: readonly FeedStoryRow[]): readonly ApiCuratedQuote[] {
  const quotes: ApiCuratedQuote[] = [];
  const said = new Set<string>();
  for (const row of [...rows].sort(byStoryDateDesc)) {
    if (quotes.length >= CURATED_QUOTES_MAX) break;
    if (row.storyType !== 'purchase' || row.reviewText === null) continue;
    const fan = fanRef(row);
    if (fan === null) continue;
    const key = `${fan.fanId}@${itemKey(row)}`;
    if (said.has(key)) continue;
    said.add(key);
    quotes.push({
      fan,
      text: row.reviewText,
      date: row.storyDate.toISOString(),
      item: {
        itemType: row.itemType,
        itemId: String(row.itemId),
        title: row.title,
        artist: row.artist,
        artId: row.artId === null ? null : String(row.artId),
        itemUrl: row.url,
      },
    });
  }
  return quotes;
}

export function buildCurated(rows: readonly FeedStoryRow[]): ApiCuratedResponse {
  return {
    boughtByFollowed: boughtByFollowed(rows),
    newFromPages: newFromPages(rows),
    inTheirOwnWords: inTheirOwnWords(rows),
  };
}

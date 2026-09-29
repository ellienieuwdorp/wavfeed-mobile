/**
 * The de-noise rules: flat Stories in, ordered Feed Items and Bursts out; type filter, then Bursts, then aggregation, then the sort (ADR-0005).
 * Ported from server/apps/api/src/feed/assemble.ts (task 0036).
 */
import type {
  ApiBurst,
  ApiBurstItem,
  ApiFanRef,
  ApiFeedElement,
  ApiFeedItem,
  ApiFeedSort,
  ApiReview,
  ApiStoryType,
} from './apiTypes';
import type { FeedStoryRow } from './rows';

export const BURST_MAX_GAP_MINUTES = 60;
export const BURST_MIN_STORIES = 5;

const BURST_MAX_GAP_MS = BURST_MAX_GAP_MINUTES * 60_000;

export const ALL_STORY_TYPES: readonly ApiStoryType[] = ['new_release', 'purchase', 'wishlist'];

const FAN_ACTED_TYPES: readonly ApiStoryType[] = ['purchase', 'wishlist'];

export type AssembleOptions = {
  readonly types: readonly ApiStoryType[];
  readonly sort: ApiFeedSort;
};

export type AssembledFeed = {
  readonly elements: readonly ApiFeedElement[];
  readonly typeCounts: Readonly<Record<ApiStoryType, number>>;
};

export function itemKey(row: { readonly itemType: string; readonly itemId: number }): string {
  return `${row.itemType}:${row.itemId}`;
}

export function groupByItem(rows: readonly FeedStoryRow[]): ReadonlyMap<string, readonly FeedStoryRow[]> {
  const groups = new Map<string, FeedStoryRow[]>();
  for (const row of rows) {
    const key = itemKey(row);
    const existing = groups.get(key);
    if (existing === undefined) groups.set(key, [row]);
    else existing.push(row);
  }
  return groups;
}

export function byStoryDateDesc(a: FeedStoryRow, b: FeedStoryRow): number {
  const delta = b.storyDate.getTime() - a.storyDate.getTime();
  return delta !== 0 ? delta : b.storyId - a.storyId;
}

export function fanRef(row: FeedStoryRow): ApiFanRef | null {
  if (row.fanId === null || row.fanUsername === null) return null;
  return {
    fanId: String(row.fanId),
    username: row.fanUsername,
    name: row.fanName,
    imageId: row.fanImageId === null ? null : String(row.fanImageId),
  };
}

function distinctFans(sorted: readonly FeedStoryRow[], type: ApiStoryType): ApiFanRef[] {
  const fans: ApiFanRef[] = [];
  const seen = new Set<string>();
  for (const row of sorted) {
    if (row.storyType !== type) continue;
    const fan = fanRef(row);
    if (fan === null || seen.has(fan.fanId)) continue;
    seen.add(fan.fanId);
    fans.push(fan);
  }
  return fans;
}

function reviewsOf(sorted: readonly FeedStoryRow[]): ApiReview[] {
  const reviews: ApiReview[] = [];
  for (const row of sorted) {
    const fan = fanRef(row);
    if (row.reviewText === null || fan === null) continue;
    reviews.push({ fan, text: row.reviewText });
  }
  return reviews;
}

export type StorySignal = {
  readonly buyers: readonly ApiFanRef[];
  readonly wishlisters: readonly ApiFanRef[];
  readonly reviews: readonly ApiReview[];
  readonly hasNewRelease: boolean;
  readonly latestStoryDate: string | null;
};

export function buildSignal(rows: readonly FeedStoryRow[]): StorySignal {
  const sorted = [...rows].sort(byStoryDateDesc);
  const newest = sorted[0];
  return {
    buyers: distinctFans(sorted, 'purchase'),
    wishlisters: distinctFans(sorted, 'wishlist'),
    reviews: reviewsOf(sorted),
    hasNewRelease: sorted.some((row) => row.storyType === 'new_release'),
    latestStoryDate: newest === undefined ? null : newest.storyDate.toISOString(),
  };
}

/** A lone Story anchors at its action date, an aggregate at the release date, else its oldest Story (ADR-0011). */
export function buildFeedItem(rows: readonly FeedStoryRow[]): ApiFeedItem {
  const sorted = [...rows].sort(byStoryDateDesc);
  const [newest] = sorted;
  if (newest === undefined) throw new Error('a Feed Item needs at least one Story');
  const oldest = sorted[sorted.length - 1] ?? newest;
  const anchor = sorted.length === 1 ? newest.storyDate : (newest.releaseDate ?? oldest.storyDate);
  const signal = buildSignal(sorted);

  return {
    kind: 'item',
    itemType: newest.itemType,
    itemId: String(newest.itemId),
    title: newest.title,
    artist: newest.artist,
    bandId: String(newest.bandId),
    label: newest.label,
    artId: newest.artId === null ? null : String(newest.artId),
    itemUrl: newest.url,
    releaseDate: newest.releaseDate === null ? null : newest.releaseDate.toISOString(),
    latestStoryDate: newest.storyDate.toISOString(),
    anchorDate: anchor.toISOString(),
    buyers: signal.buyers,
    wishlisters: signal.wishlisters,
    hasNewRelease: signal.hasNewRelease,
    reviews: signal.reviews,
    featuredTrackId: newest.featuredTrackId === null ? null : String(newest.featuredTrackId),
    featuredTrackTitle: newest.featuredTrackTitle,
    featuredTrackDuration: newest.featuredTrackDuration,
    numStreamableTracks: newest.numStreamableTracks,
  };
}

function burstStoryType(rows: readonly FeedStoryRow[]): ApiStoryType | 'mixed' {
  const types = new Set(rows.map((row) => row.storyType));
  const [only] = [...types];
  return types.size === 1 && only !== undefined ? only : 'mixed';
}

function buildBurst(chain: readonly FeedStoryRow[]): ApiBurst {
  const newestFirst = [...chain].sort(byStoryDateDesc);
  const [newest] = newestFirst;
  if (newest === undefined) throw new Error('a Burst needs at least one Story');
  const fan = fanRef(newest);
  if (fan === null) throw new Error('a Burst needs the Fan who acted');

  const items: ApiBurstItem[] = [];
  const seenItems = new Set<string>();
  for (const row of newestFirst) {
    const key = itemKey(row);
    if (seenItems.has(key)) continue;
    seenItems.add(key);
    items.push({
      itemType: row.itemType,
      itemId: String(row.itemId),
      title: row.title,
      artist: row.artist,
      artId: row.artId === null ? null : String(row.artId),
      itemUrl: row.url,
      storyDate: row.storyDate.toISOString(),
    });
  }

  const latest = newest.storyDate.toISOString();
  return {
    kind: 'burst',
    fan,
    storyCount: chain.length,
    storyType: burstStoryType(chain),
    latestStoryDate: latest,
    anchorDate: latest,
    items,
  };
}

export type DetectedBursts = {
  readonly bursts: readonly ApiBurst[];
  readonly memberStoryIds: ReadonlySet<number>;
};

/** One Fan's fan-acted Stories chained while each gap stays inside the maximum, kept at the minimum length. */
export function detectBursts(rows: readonly FeedStoryRow[]): DetectedBursts {
  const byFan = new Map<number, FeedStoryRow[]>();
  for (const row of rows) {
    if (row.fanId === null || !FAN_ACTED_TYPES.includes(row.storyType)) continue;
    const existing = byFan.get(row.fanId);
    if (existing === undefined) byFan.set(row.fanId, [row]);
    else existing.push(row);
  }

  const bursts: ApiBurst[] = [];
  const memberStoryIds = new Set<number>();
  for (const fanRows of byFan.values()) {
    const oldestFirst = [...fanRows].sort((a, b) => -byStoryDateDesc(a, b));
    let chain: FeedStoryRow[] = [];
    const close = (): void => {
      if (chain.length < BURST_MIN_STORIES) return;
      bursts.push(buildBurst(chain));
      for (const row of chain) memberStoryIds.add(row.storyId);
    };
    for (const row of oldestFirst) {
      const previous = chain[chain.length - 1];
      if (previous !== undefined && row.storyDate.getTime() - previous.storyDate.getTime() > BURST_MAX_GAP_MS) {
        close();
        chain = [];
      }
      chain.push(row);
    }
    close();
  }
  return { bursts, memberStoryIds };
}

/** Blind to the type filter and to Burst collapse: the chips count Releases in the collection. */
export function countTypes(rows: readonly FeedStoryRow[]): Readonly<Record<ApiStoryType, number>> {
  const counts: Record<ApiStoryType, number> = { purchase: 0, new_release: 0, wishlist: 0 };
  for (const itemRows of groupByItem(rows).values()) {
    for (const type of ALL_STORY_TYPES) {
      if (itemRows.some((row) => row.storyType === type)) counts[type] += 1;
    }
  }
  return counts;
}

export type ElementSortKey = {
  readonly sortDate: string;
  readonly tiebreak: string;
};

export function elementSortKey(element: ApiFeedElement, sort: ApiFeedSort): ElementSortKey {
  return {
    sortDate: sort === 'activity' ? element.latestStoryDate : element.anchorDate,
    tiebreak:
      element.kind === 'item'
        ? `item:${element.itemType}:${element.itemId}`
        : `burst:${element.fan.fanId}:${element.latestStoryDate}`,
  };
}

export function compareSortKeys(a: ElementSortKey, b: ElementSortKey): number {
  const byDate = b.sortDate.localeCompare(a.sortDate);
  return byDate !== 0 ? byDate : a.tiebreak.localeCompare(b.tiebreak);
}

export function assembleFeed(rows: readonly FeedStoryRow[], options: AssembleOptions): AssembledFeed {
  const typeCounts = countTypes(rows);
  const kept = rows.filter((row) => options.types.includes(row.storyType));
  const { bursts, memberStoryIds } = detectBursts(kept);

  const items: ApiFeedElement[] = [];
  for (const itemRows of groupByItem(kept).values()) {
    const outsideBursts = itemRows.filter((row) => !memberStoryIds.has(row.storyId));
    if (outsideBursts.length > 0) items.push(buildFeedItem(outsideBursts));
  }

  const elements = [...items, ...bursts].sort((a, b) =>
    compareSortKeys(elementSortKey(a, options.sort), elementSortKey(b, options.sort)),
  );
  return { elements, typeCounts };
}

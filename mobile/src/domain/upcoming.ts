/**
 * The Upcoming band's rules: Releases around now, nearest first, each carrying only the signal its Stories give; release days are GMT days (ADR-0017).
 */
import { DAY_MS } from '../lib/time';
import type { ApiUpcomingRelease } from './apiTypes';
import { buildSignal, itemKey } from './assemble';
import type { FeedStoryRow, UpcomingReleaseRow } from './rows';

/** A fortnight back, so a Release only the sweep knows is still drawn on the morning it comes out. */
export const UPCOMING_HANDOFF_DAYS = 14;

/**
 * ceiling: 500 Releases per half, and 500 more a named Fan bought; paging complete Releases is the upgrade if a
 * catalog outgrows it.
 */
export const UPCOMING_MAX_RELEASES = 500;

export function startOfReleaseDay(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/** The first instant of the next release day: at or after it, not out yet. */
export function aheadFrom(now: Date): Date {
  return new Date(startOfReleaseDay(now).getTime() + DAY_MS);
}

export function handoffFloor(now: Date): Date {
  return new Date(startOfReleaseDay(now).getTime() - UPCOMING_HANDOFF_DAYS * DAY_MS);
}

function groupStoriesByItem(stories: readonly FeedStoryRow[]): ReadonlyMap<string, readonly FeedStoryRow[]> {
  const groups = new Map<string, FeedStoryRow[]>();
  for (const story of stories) {
    const key = itemKey(story);
    const existing = groups.get(key);
    if (existing === undefined) groups.set(key, [story]);
    else existing.push(story);
  }
  return groups;
}

function byReleaseDateAsc(a: UpcomingReleaseRow, b: UpcomingReleaseRow): number {
  const delta = a.releaseDate.getTime() - b.releaseDate.getTime();
  if (delta !== 0) return delta;
  if (a.itemType !== b.itemType) return a.itemType < b.itemType ? -1 : 1;
  return a.itemId - b.itemId;
}

export function buildUpcoming(
  releases: readonly UpcomingReleaseRow[],
  stories: readonly FeedStoryRow[],
): readonly ApiUpcomingRelease[] {
  const byItem = groupStoriesByItem(stories);
  return [...releases].sort(byReleaseDateAsc).map((release) => {
    const signal = buildSignal(byItem.get(itemKey(release)) ?? []);
    return {
      itemType: release.itemType,
      itemId: String(release.itemId),
      title: release.title,
      pageName: release.pageName,
      artistCredit: release.artistCredit,
      bandId: String(release.bandId),
      label: release.label,
      tags: release.tags,
      artId: release.artId === null ? null : String(release.artId),
      itemUrl: release.url,
      releaseDate: release.releaseDate.toISOString(),
      isPreorder: release.isPreorder,
      latestStoryDate: signal.latestStoryDate,
      buyers: signal.buyers,
      wishlisters: signal.wishlisters,
      hasNewRelease: signal.hasNewRelease,
      reviews: signal.reviews,
      featuredTrackId: release.featuredTrackId === null ? null : String(release.featuredTrackId),
      featuredTrackTitle: release.featuredTrackTitle,
      featuredTrackDuration: release.featuredTrackDuration,
      numStreamableTracks: release.numStreamableTracks,
      numTracks: release.numTracks,
    };
  });
}

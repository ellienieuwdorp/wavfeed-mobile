/**
 * The New releases filter over the view the screen draws (task 0071, decisions 8 and 21): tags combine as any of them,
 * and the tags and the people minimum combine as both; a Release passes the people filter when at least that many
 * Fans held in `fans` bought it, its `buyers`. Each Release is judged once by its key, so the shelf, a Drop and its own
 * row agree, and a week left empty goes, so no week head stands over nothing. The counts are of Releases, not rows:
 * tag counts after the people filter (Open 3), what each people minimum alone keeps, everything chosen together, and
 * the whole view.
 */
import type { ApiFanRef, ApiTag } from './apiTypes';
import type { NewReleasesView } from './newReleases';

export const PEOPLE_MIN = 1;
export const PEOPLE_MAX = 6;

export type ReleaseFilter = {
  readonly people: { readonly on: boolean; readonly min: number };
  /** Tag norm names; empty keeps every Release. */
  readonly tags: readonly string[];
};

export type TagCount = {
  readonly normName: string;
  readonly name: string;
  readonly count: number;
};

export type MinimumCount = {
  readonly min: number;
  readonly count: number;
};

export type FilteredNewReleases = {
  readonly view: NewReleasesView;
  /** Releases in the unfiltered view. */
  readonly total: number;
  /** Releases the whole filter keeps: the length of `view` in Releases. */
  readonly matching: number;
  /** For each minimum from `PEOPLE_MIN` to `PEOPLE_MAX`, the Releases it keeps with no tag chosen. */
  readonly byMinimum: readonly MinimumCount[];
  /** Every tag in the view, highest count first, each counted over the Releases the people filter keeps. */
  readonly tags: readonly TagCount[];
};

type Judged = { readonly buyers: readonly ApiFanRef[]; readonly tags: readonly ApiTag[] };

function keyOf(release: { readonly itemType: string; readonly itemId: string }): string {
  return `${release.itemType}:${release.itemId}`;
}

/** A minimum the sheet's stepper could not show is brought inside its range. */
export function clampMinimum(min: number): number {
  return Number.isFinite(min) ? Math.min(PEOPLE_MAX, Math.max(PEOPLE_MIN, Math.trunc(min))) : PEOPLE_MIN;
}

export function filterNewReleases(view: NewReleasesView, filter: ReleaseFilter): FilteredNewReleases {
  // ceiling: counts every Release in JS over the whole view on each change; a derived release_tags table indexed on norm_name is the upgrade.
  const releases = new Map<string, Judged>();
  for (const release of view.upcoming) if (!releases.has(keyOf(release))) releases.set(keyOf(release), release);
  for (const week of view.weeks) {
    for (const entry of week.releases) if (!releases.has(keyOf(entry.release))) releases.set(keyOf(entry.release), entry.release);
  }

  const min = clampMinimum(filter.people.min);
  const chosen = new Set(filter.tags);
  const byPeople = (release: Judged): boolean => !filter.people.on || release.buyers.length >= min;
  const byTags = (release: Judged): boolean => chosen.size === 0 || release.tags.some((tag) => chosen.has(tag.normName));

  const kept = new Set<string>();
  const tagCounts = new Map<string, { name: string; count: number }>();
  const atLeast = Array.from({ length: PEOPLE_MAX + 1 }, () => 0);
  for (const [key, release] of releases) {
    const people = byPeople(release);
    if (people && byTags(release)) kept.add(key);
    const bought = Math.min(PEOPLE_MAX, release.buyers.length);
    atLeast[bought] = (atLeast[bought] ?? 0) + 1;
    for (const tag of release.tags) {
      const held = tagCounts.get(tag.normName) ?? { name: tag.name, count: 0 };
      if (people) held.count += 1;
      tagCounts.set(tag.normName, held);
    }
  }

  const byMinimum: MinimumCount[] = [];
  let reaching = 0;
  for (let n = PEOPLE_MAX; n >= PEOPLE_MIN; n -= 1) {
    reaching += atLeast[n] ?? 0;
    byMinimum.unshift({ min: n, count: reaching });
  }
  const tags = [...tagCounts.entries()]
    .map(([normName, { name, count }]) => ({ normName, name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

  const active = filter.people.on || chosen.size > 0;
  const keeps = (release: { readonly itemType: string; readonly itemId: string }): boolean => kept.has(keyOf(release));
  const filtered: NewReleasesView = active
    ? {
        upcoming: view.upcoming.filter(keeps),
        weeks: view.weeks
          .map((week) => ({ weekStart: week.weekStart, releases: week.releases.filter((entry) => keeps(entry.release)) }))
          .filter((week) => week.releases.length > 0),
      }
    : view;
  return { view: filtered, total: releases.size, matching: kept.size, byMinimum, tags };
}

/**
 * The tags the Filters sheet lists (decision 7): every tag whose name holds the search, else the first `first` by
 * count with any chosen tag kept in view, so a chosen tag can always be taken off; a chosen tag the view no longer
 * holds follows at 0.
 */
export function shownTags(tags: readonly TagCount[], chosen: readonly string[], query: string, first: number): readonly TagCount[] {
  const known = new Set(tags.map((tag) => tag.normName));
  const listed = [...tags, ...chosen.filter((tag) => !known.has(tag)).map((tag) => ({ normName: tag, name: tag, count: 0 }))];
  const q = query.trim().toLowerCase();
  if (q !== '') return listed.filter((tag) => tag.name.toLowerCase().includes(q) || tag.normName.includes(q));
  const picked = new Set(chosen);
  return listed.filter((tag, n) => n < first || picked.has(tag.normName));
}

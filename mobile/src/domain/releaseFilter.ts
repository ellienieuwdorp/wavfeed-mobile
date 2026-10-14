/**
 * The New releases filter over the view the screen draws (task 0071, decisions 8 and 21): tags combine as any of them,
 * and the tags and the people minimum combine as both; a Release passes the people filter when at least that many
 * Fans held in `fans` bought it, its `buyers`. Each Release is judged once by its key, so the shelf, a Drop and its own
 * row agree, and a week left empty goes, so no week head stands over nothing. The counts are of Releases, not rows:
 * tag counts after the people filter (Open 3), what each people minimum alone keeps, everything chosen together, and
 * the whole view. What does not hang on the filter is worked out once per view, and the last few answers are held, so
 * the sheet and the list behind it share one pass per tap.
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

type Judged = { readonly key: string; readonly bought: number; readonly tags: readonly ApiTag[] };

/**
 * What a view's filters share, worked out once per view: each Release once by its key with its buyer count and tags,
 * the count each minimum alone keeps, the tag counts for each people setting, and the last few results, so a tap in
 * the Filters sheet is one pass over the Releases and the sheet and the list behind it share the answer.
 */
type ViewIndex = {
  readonly releases: readonly Judged[];
  readonly byMinimum: readonly MinimumCount[];
  readonly tagsByPeople: Map<string, readonly TagCount[]>;
  readonly results: Map<string, FilteredNewReleases>;
};

/** Results held per view: enough for the sheet's live settings and the list's deferred ones to both hit. */
const HELD_RESULTS = 8;
const indexes = new WeakMap<NewReleasesView, ViewIndex>();

function keyOf(release: { readonly itemType: string; readonly itemId: string }): string {
  return `${release.itemType}:${release.itemId}`;
}

/** A minimum the sheet's stepper could not show is brought inside its range. */
export function clampMinimum(min: number): number {
  return Number.isFinite(min) ? Math.min(PEOPLE_MAX, Math.max(PEOPLE_MIN, Math.trunc(min))) : PEOPLE_MIN;
}

function indexOf(view: NewReleasesView): ViewIndex {
  const held = indexes.get(view);
  if (held !== undefined) return held;
  const seen = new Map<string, Judged>();
  const add = (release: { readonly itemType: string; readonly itemId: string; readonly buyers: readonly ApiFanRef[]; readonly tags: readonly ApiTag[] }) => {
    const key = keyOf(release);
    if (!seen.has(key)) seen.set(key, { key, bought: release.buyers.length, tags: release.tags });
  };
  for (const release of view.upcoming) add(release);
  for (const week of view.weeks) for (const entry of week.releases) add(entry.release);
  const releases = [...seen.values()];

  const atLeast = Array.from({ length: PEOPLE_MAX + 1 }, () => 0);
  for (const release of releases) {
    const bought = Math.min(PEOPLE_MAX, release.bought);
    atLeast[bought] = (atLeast[bought] ?? 0) + 1;
  }
  const byMinimum: MinimumCount[] = [];
  let reaching = 0;
  for (let n = PEOPLE_MAX; n >= PEOPLE_MIN; n -= 1) {
    reaching += atLeast[n] ?? 0;
    byMinimum.unshift({ min: n, count: reaching });
  }
  const index: ViewIndex = { releases, byMinimum, tagsByPeople: new Map(), results: new Map() };
  indexes.set(view, index);
  return index;
}

/** Every tag in the view, counted over the Releases the people setting keeps (Open 3), highest count first. */
function tagCounts(index: ViewIndex, people: (release: Judged) => boolean, key: string): readonly TagCount[] {
  const held = index.tagsByPeople.get(key);
  if (held !== undefined) return held;
  const counts = new Map<string, { name: string; count: number }>();
  for (const release of index.releases) {
    const kept = people(release);
    for (const tag of release.tags) {
      let count = counts.get(tag.normName);
      if (count === undefined) {
        count = { name: tag.name, count: 0 };
        counts.set(tag.normName, count);
      }
      if (kept) count.count += 1;
    }
  }
  const tags = [...counts.entries()]
    .map(([normName, { name, count }]) => ({ normName, name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  index.tagsByPeople.set(key, tags);
  return tags;
}

export function filterNewReleases(view: NewReleasesView, filter: ReleaseFilter): FilteredNewReleases {
  // ceiling: counts every Release in JS over the whole view, once per view and filter; a derived release_tags table indexed on norm_name is the upgrade.
  const index = indexOf(view);
  const min = clampMinimum(filter.people.min);
  const chosen = new Set(filter.tags);
  const people = filter.people.on ? `${min}` : 'off';
  const key = `${people}|${[...chosen].sort().join('\u0000')}`;
  const held = index.results.get(key);
  if (held !== undefined) return held;

  const byPeople = (release: Judged): boolean => !filter.people.on || release.bought >= min;
  const byTags = (release: Judged): boolean => chosen.size === 0 || release.tags.some((tag) => chosen.has(tag.normName));
  const kept = new Set<string>();
  for (const release of index.releases) if (byPeople(release) && byTags(release)) kept.add(release.key);

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
  const result: FilteredNewReleases = { view: filtered, total: index.releases.length, matching: kept.size, byMinimum: index.byMinimum, tags: tagCounts(index, byPeople, people) };
  if (index.results.size >= HELD_RESULTS) index.results.delete(index.results.keys().next().value as string);
  index.results.set(key, result);
  return result;
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

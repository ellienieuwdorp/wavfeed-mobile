/**
 * The New releases view's two halves: the Upcoming band (not out yet) and the released weeks, which add a just-out Release no Story reached.
 * Ported from server/apps/web/src/components/browse/NewReleaseWeeks.tsx and lib/dates.ts (task 0036).
 */
import type { ApiFeedElement, ApiFeedItem, ApiUpcomingRelease } from './apiTypes';

/** A Release placed in the released weeks, whichever half it came from. `date` is what the week and day label read. */
export type DatedRelease = {
  readonly key: string;
  readonly date: Date;
  readonly release: ApiFeedItem | ApiUpcomingRelease;
};

/** A Monday-to-Sunday week in local time (ADR-0011), newest first. */
export type NewReleaseWeek = {
  readonly weekStart: Date;
  readonly releases: readonly DatedRelease[];
};

export type NewReleasesView = {
  /** Not out yet, nearest release date first. */
  readonly upcoming: readonly ApiUpcomingRelease[];
  /** Newest week first; weeks with no entries are absent. */
  readonly weeks: readonly NewReleaseWeek[];
};

/** A GMT release day (`2026-09-14...`) as local midnight of that calendar date. */
export function releaseDay(value: string): Date {
  const [year, month, day] = value.slice(0, 10).split('-').map(Number);
  if (year === undefined || month === undefined || day === undefined || Number.isNaN(day)) return new Date(Number.NaN);
  return new Date(year, month - 1, day);
}

/** Both days are GMT days; an unreadable date is not claimed to be out. */
export function isOutYet(releaseDate: string, now: Date): boolean {
  const day = Date.parse(`${releaseDate.slice(0, 10)}T00:00:00.000Z`);
  if (Number.isNaN(day)) return false;
  return day <= Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
}

export function startOfWeek(value: Date): Date {
  const date = new Date(value.getFullYear(), value.getMonth(), value.getDate());
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() - ((date.getDay() + 6) % 7));
}

/**
 * A Feed Item dated ahead of its release day belongs to the band only, and a
 * just-out Release the feed already holds is not drawn twice.
 */
export function buildNewReleases(
  elements: readonly ApiFeedElement[],
  releases: readonly ApiUpcomingRelease[],
  now: Date,
): NewReleasesView {
  const upcoming = releases.filter((release) => !isOutYet(release.releaseDate, now));
  const justOut = releases.filter((release) => isOutYet(release.releaseDate, now));

  const dated: DatedRelease[] = [];
  const drawn = new Set<string>();
  for (const element of elements) {
    if (element.kind !== 'item') continue;
    if (element.releaseDate !== null && !isOutYet(element.releaseDate, now)) continue;
    dated.push({ key: `item:${element.itemType}:${element.itemId}`, date: new Date(element.anchorDate), release: element });
    drawn.add(`${element.itemType}:${element.itemId}`);
  }
  for (const release of justOut) {
    const key = `${release.itemType}:${release.itemId}`;
    if (drawn.has(key)) continue;
    dated.push({ key: `upcoming:${key}`, date: releaseDay(release.releaseDate), release });
  }

  const buckets = new Map<number, { readonly weekStart: Date; readonly releases: DatedRelease[] }>();
  for (const placed of dated) {
    if (Number.isNaN(placed.date.getTime())) continue;
    const weekStart = startOfWeek(placed.date);
    const bucket = buckets.get(weekStart.getTime());
    if (bucket === undefined) buckets.set(weekStart.getTime(), { weekStart, releases: [placed] });
    else bucket.releases.push(placed);
  }
  const weeks = [...buckets.values()]
    .sort((a, b) => b.weekStart.getTime() - a.weekStart.getTime())
    .map((week) => ({
      weekStart: week.weekStart,
      releases: [...week.releases].sort((a, b) => b.date.getTime() - a.date.getTime()),
    }));
  return { upcoming, weeks };
}

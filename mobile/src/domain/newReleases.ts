/**
 * The New releases view's two halves: the Upcoming band (not out yet) and the released weeks, which add a just-out Release no Story reached,
 * and the Drops of Upcoming Releases on their days (task 0041, decision 10).
 * Ported from server/apps/web/src/components/browse/NewReleaseWeeks.tsx and lib/dates.ts (task 0036).
 */
import type { ApiFeedElement, ApiFeedItem, ApiUpcomingRelease } from './apiTypes';
import { itemKey } from './assemble';
import type { DropRow, FeedStoryRow } from './rows';
import { buildUpcoming } from './upcoming';

/** A Release placed in the released weeks, whichever half it came from. `date` is what the week and day label read. */
export type DatedRelease = {
  readonly kind: 'release';
  readonly key: string;
  readonly date: Date;
  readonly release: ApiFeedItem | ApiUpcomingRelease;
};

/** A Drop as the store reads it: its Release, how many of its Tracks play of how many, and its GMT day (task 0041, decision 6). */
export type Drop = {
  readonly release: ApiUpcomingRelease;
  /** `2026-10-06`. */
  readonly day: string;
  readonly tracksOut: number;
  readonly numTracks: number | null;
  /** The last Track it let out, which its row plays from (decision 10); null until a release page names its Tracks. */
  readonly newestTrackId: string | null;
};

/** A Drop placed in the released weeks on its day; `releaseDay` is the Release's own, its row's "out Tue 13 Oct". */
export type DatedDrop = {
  readonly kind: 'drop';
  /** One per Release and day: `drop:a:<itemId>:<day>`. */
  readonly key: string;
  readonly date: Date;
  readonly release: ApiUpcomingRelease;
  readonly tracksOut: number;
  readonly numTracks: number | null;
  readonly releaseDay: Date;
  readonly newestTrackId: string | null;
};

export type DatedEntry = DatedRelease | DatedDrop;

/** Each Drop's Release as the Upcoming rules build it, with the signal its Stories give. */
export function buildDrops(drops: readonly DropRow[], stories: readonly FeedStoryRow[]): readonly Drop[] {
  const releases = new Map(drops.map((drop) => [itemKey(drop.release), drop.release]));
  const built = new Map(
    buildUpcoming([...releases.values()], stories.filter((row) => releases.has(itemKey(row)))).map((release) => [
      `${release.itemType}:${release.itemId}`,
      release,
    ]),
  );
  return drops.flatMap((drop) => {
    const release = built.get(itemKey(drop.release));
    if (release === undefined) return [];
    const newestTrackId = drop.newestTrackId === null ? null : String(drop.newestTrackId);
    return [{ release, day: drop.day, tracksOut: drop.tracksOut, numTracks: drop.numTracks, newestTrackId }];
  });
}

/** A Monday-to-Sunday week in local time (ADR-0011), newest first. */
export type NewReleaseWeek = {
  readonly weekStart: Date;
  readonly releases: readonly DatedEntry[];
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
 * Where a Feed Item sits in the released weeks: on its release day when the feed stated it or the Release was held
 * before it, else on its anchor (task 0041, decision 3). A reissue whose page states a day years before its Story
 * keeps the Story's place.
 */
function placedOn(element: ApiFeedItem): Date {
  return element.releaseDate !== null && element.onReleaseDay ? releaseDay(element.releaseDate) : new Date(element.anchorDate);
}

/**
 * A Feed Item dated ahead of its release day belongs to the band only, and so does a pre-order no page has dated yet
 * (task 0041, decision 1). A just-out Release the feed already holds is not drawn twice. A Drop sits on its own day
 * beside them, unless the Release's own row is on that day.
 */
export function buildNewReleases(
  elements: readonly ApiFeedElement[],
  releases: readonly ApiUpcomingRelease[],
  now: Date,
  drops: readonly Drop[] = [],
): NewReleasesView {
  const upcoming = releases.filter((release) => !isOutYet(release.releaseDate, now));
  const justOut = releases.filter((release) => isOutYet(release.releaseDate, now));

  const dated: DatedEntry[] = [];
  /** Each Release's own row by its key, and where it sits: local midnight when on its release day. */
  const drawn = new Map<string, number>();
  for (const element of elements) {
    if (element.kind !== 'item') continue;
    if (element.releaseDate === null ? element.isPreorder : !isOutYet(element.releaseDate, now)) continue;
    const date = placedOn(element);
    dated.push({ kind: 'release', key: `item:${element.itemType}:${element.itemId}`, date, release: element });
    drawn.set(`${element.itemType}:${element.itemId}`, date.getTime());
  }
  for (const release of justOut) {
    const key = `${release.itemType}:${release.itemId}`;
    if (drawn.has(key)) continue;
    const date = releaseDay(release.releaseDate);
    dated.push({ kind: 'release', key: `upcoming:${key}`, date, release });
    drawn.set(key, date.getTime());
  }
  for (const drop of drops) {
    const release = drop.release;
    const key = `${release.itemType}:${release.itemId}`;
    const date = releaseDay(drop.day);
    // On its release day the Release's own row stands for it; earlier Drops stay where they happened (decision 10).
    if (drawn.get(key) === date.getTime()) continue;
    dated.push({
      kind: 'drop',
      key: `drop:${key}:${drop.day}`,
      date,
      release,
      tracksOut: drop.tracksOut,
      numTracks: drop.numTracks,
      releaseDay: releaseDay(release.releaseDate),
      newestTrackId: drop.newestTrackId,
    });
  }

  const buckets = new Map<number, { readonly weekStart: Date; readonly releases: DatedEntry[] }>();
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

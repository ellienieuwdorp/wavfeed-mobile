/**
 * Flat Story rows as the store's wide join hands them to the feed rules, built by hand so the rules can be argued with
 * without a database. Ported from server/apps/api/test/helpers/rows.ts, less the seen and starred fields (task 0036).
 */
import type { FeedStoryRow } from '../src/domain/rows';

/** Every row gets a distinct id, which is what breaks ties between Stories inside one millisecond. */
let nextStoryId = 0;

export const BASE_DATE = new Date('2026-08-19T10:00:00.000Z');

/** A time relative to {@link BASE_DATE}, which is how the Burst cases read best. */
export function minutesAfter(minutes: number, from: Date = BASE_DATE): Date {
  return new Date(from.getTime() + minutes * 60_000);
}

export function daysBefore(days: number, from: Date = BASE_DATE): Date {
  return new Date(from.getTime() - days * 24 * 60 * 60_000);
}

/** A date ahead of {@link BASE_DATE}, which is what a pre-order's release date is. */
export function daysAfter(days: number, from: Date = BASE_DATE): Date {
  return daysBefore(-days, from);
}

export function storyRow(overrides: Partial<FeedStoryRow> = {}): FeedStoryRow {
  nextStoryId += 1;
  return {
    storyId: nextStoryId,
    storyType: 'purchase',
    storyDate: BASE_DATE,
    reviewText: null,
    fanId: 101,
    fanUsername: 'dj_okonkwo',
    fanName: 'Ada Okonkwo',
    fanImageId: 88123456,
    itemType: 'a',
    itemId: 5001,
    bandId: 900,
    title: 'Slow Harbour',
    url: 'https://nightgraft.bandcamp.com/album/slow-harbour',
    artId: 1204871,
    releaseDate: null,
    label: 'Halfmoon Tapes',
    featuredTrackId: 55501122,
    featuredTrackTitle: 'Low Tide',
    featuredTrackDuration: 314.52,
    numStreamableTracks: 8,
    numTracks: null,
    isPreorder: false,
    // A day the feed states, which New releases places the row on.
    onReleaseDay: true,
    artist: 'Nightgraft',
    ...overrides,
  };
}

/** A new_release: nobody acted, so every Fan field is null, as the join gives it. */
export function newReleaseRow(overrides: Partial<FeedStoryRow> = {}): FeedStoryRow {
  return storyRow({
    storyType: 'new_release',
    fanId: null,
    fanUsername: null,
    fanName: null,
    fanImageId: null,
    ...overrides,
  });
}

export type ChainOptions = {
  readonly count: number;
  readonly gapMinutes: number;
  readonly start?: Date;
  /** The first Release id; each Story in the run takes the next one. */
  readonly firstItemId?: number;
  readonly row?: Partial<FeedStoryRow>;
};

/** One Fan's run of Stories, `gapMinutes` apart, oldest first. */
export function chain(options: ChainOptions): FeedStoryRow[] {
  const { count, gapMinutes, start = BASE_DATE, firstItemId = 6000, row = {} } = options;
  return Array.from({ length: count }, (_, index) =>
    storyRow({
      ...row,
      storyDate: minutesAfter(index * gapMinutes, start),
      itemId: firstItemId + index,
      title: `Chain ${firstItemId + index}`,
    }),
  );
}

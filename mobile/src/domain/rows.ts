/**
 * The flat rows the feed rules read: a Story with its Release, Page and Fan, an Upcoming Release with its Page, and a
 * Drop with its Release (task 0041); no seen or starred on the phone.
 * Ported from server/packages/db/src/types.ts, FeedStoryRow and UpcomingReleaseRow (task 0036).
 */
import type { ItemType, StoryType } from './types';

export type FeedStoryRow = {
  readonly storyId: number;
  readonly storyType: StoryType;
  readonly storyDate: Date;
  readonly reviewText: string | null;
  readonly fanId: number | null;
  readonly fanUsername: string | null;
  readonly fanName: string | null;
  readonly fanImageId: number | null;
  readonly itemType: ItemType;
  readonly itemId: number;
  readonly bandId: number;
  readonly title: string;
  readonly url: string;
  readonly artId: number | null;
  readonly releaseDate: Date | null;
  readonly label: string | null;
  readonly featuredTrackId: number | null;
  readonly featuredTrackTitle: string | null;
  readonly featuredTrackDuration: number | null;
  readonly numStreamableTracks: number | null;
  /** Every Track the newest release page named; null until one is read (task 0041, decision 4). */
  readonly numTracks: number | null;
  /** A pre-order as the newest source stated it; an undated one waits for its page (task 0041, decision 1). */
  readonly isPreorder: boolean;
  /**
   * New releases may place it on `releaseDate`: the feed stated that day, or the Release was held before it came out
   * (task 0041, decision 3). A day a page or the Sweep states for a Release first seen after it, a reissue's, is not.
   */
  readonly onReleaseDay: boolean;
  /** The Page's name, which the UI calls the artist. */
  readonly artist: string;
};

export type UpcomingReleaseRow = {
  readonly itemType: ItemType;
  readonly itemId: number;
  readonly bandId: number;
  readonly title: string;
  readonly url: string;
  readonly artId: number | null;
  readonly releaseDate: Date;
  readonly isPreorder: boolean;
  readonly label: string | null;
  readonly featuredTrackId: number | null;
  readonly featuredTrackTitle: string | null;
  readonly featuredTrackDuration: number | null;
  readonly numStreamableTracks: number | null;
  /** Every Track the newest release page named; null until one is read (task 0041, decision 4). */
  readonly numTracks: number | null;
  readonly artist: string;
};

/** A Drop with its Release as the Upcoming rows carry it; the counts are the Drop's own (task 0041, decision 6). */
export type DropRow = {
  readonly release: UpcomingReleaseRow;
  /** The GMT day, `2026-10-06`. */
  readonly day: string;
  readonly tracksOut: number;
  /** The Drop's total, else the Release's once a page names it. */
  readonly numTracks: number | null;
  /** The last of the Tracks it let out in track order; null until a release page names them. */
  readonly newestTrackId: number | null;
};

/**
 * The flat rows the feed rules read: a Story with its Release, Page and Fan, an Upcoming Release with its Page, and a
 * Drop with its Release; no seen or starred on the phone.
 */
import type { FeedTag } from './views';
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
  /** Every Track the newest release page named; null until one is read. */
  readonly numTracks: number | null;
  /** A pre-order as the newest source stated it; an undated one waits for its page. */
  readonly isPreorder: boolean;
  /**
   * New releases may place it on `releaseDate`: the feed stated that day, or the Release was held before it came out. A day a page or the Sweep states for a Release first seen after it, a reissue's, is not.
   */
  readonly onReleaseDay: boolean;
  /** The name of the Page that holds the Release, a label's as often as the artist's. */
  readonly pageName: string;
  /** Who the Release is by; null when no feed entry or release page credited anyone. */
  readonly artistCredit: string | null;
  /** The feed's tags, places left out. */
  readonly tags: readonly FeedTag[];
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
  /** Every Track the newest release page named; null until one is read. */
  readonly numTracks: number | null;
  /** As `FeedStoryRow.pageName`, `artistCredit` and `tags`. */
  readonly pageName: string;
  readonly artistCredit: string | null;
  readonly tags: readonly FeedTag[];
};

/** A Drop with its Release as the Upcoming rows carry it; the counts are the Drop's own. */
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

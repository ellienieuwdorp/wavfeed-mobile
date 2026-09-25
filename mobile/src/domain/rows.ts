/**
 * The flat rows the feed rules read: a Story with its Release, Page and Fan, and an Upcoming Release with its Page; no seen or starred on the phone.
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
  readonly artist: string;
};

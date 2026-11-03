/**
 * The shapes the phone's screens render, read from the Projection (src/store/queries.ts) in CONTEXT.md's terms.
 */
import type { WishlistWriteKind } from '@/bandcamp/wishlist';

import type { ItemType, StoryType } from './types';

/** A Fan referenced from a signal: enough to name them and draw an avatar. */
export type FanRef = {
  readonly fanId: string;
  readonly username: string;
  readonly name: string | null;
  /** Bandcamp image id for `f4.bcbits.com/img/<imageId>_42.jpg`; null means initials. */
  readonly imageId: string | null;
};

/** A feed tag on a Release: `normName` matches, `name` is shown. Places are never one. */
export type FeedTag = {
  readonly name: string;
  readonly normName: string;
};

/** Review text a Fan wrote alongside a purchase (the wire's `why` field). */
export type Review = {
  readonly fan: FanRef;
  readonly text: string;
};

export type FeedItem = {
  readonly kind: 'item';
  readonly itemType: ItemType;
  readonly itemId: string;
  readonly title: string;
  /** The name of the Release's Page, which is a label's as often as the artist's. */
  readonly pageName: string;
  /** Who the Release is by; null when nothing credited anyone. `creditLine` (credit.ts) puts the two together. */
  readonly artistCredit: string | null;
  readonly bandId: string;
  readonly label: string | null;
  readonly tags: readonly FeedTag[];
  /** Bandcamp art id for `f4.bcbits.com/img/a<artId>_<size>.jpg`; null means placeholder. */
  readonly artId: string | null;
  readonly itemUrl: string;
  /** Known only once a new-release Story carried it (see schema notes). */
  readonly releaseDate: string | null;
  readonly latestStoryDate: string;
  readonly anchorDate: string;
  readonly buyers: readonly FanRef[];
  readonly wishlisters: readonly FanRef[];
  readonly hasNewRelease: boolean;
  readonly reviews: readonly Review[];
  readonly featuredTrackId: string | null;
  readonly featuredTrackTitle: string | null;
  readonly featuredTrackDuration: number | null;
  readonly numStreamableTracks: number | null;
  /** How many Tracks the release page names, out or not; null until a page is read. */
  readonly numTracks: number | null;
  /** New releases leaves an undated pre-order to its page. */
  readonly isPreorder: boolean;
  /** New releases places it on its release day, not its anchor (`FeedStoryRow.onReleaseDay`). */
  readonly onReleaseDay: boolean;
};

/** One member of a Burst, enough for the expanded mini rows. */
export type BurstMember = {
  readonly itemType: ItemType;
  readonly itemId: string;
  readonly title: string;
  readonly pageName: string;
  readonly artistCredit: string | null;
  readonly artId: string | null;
  readonly itemUrl: string;
  readonly storyDate: string;
};

export type Burst = {
  readonly kind: 'burst';
  readonly fan: FanRef;
  readonly storyCount: number;
  readonly storyType: StoryType | 'mixed';
  readonly latestStoryDate: string;
  readonly anchorDate: string;
  readonly items: readonly BurstMember[];
};

export type FeedElement = FeedItem | Burst;

export type FeedSort = 'activity' | 'anchor';

/** A quote for the Curated Feed's 'In their own words' module. */
export type CuratedQuote = {
  readonly fan: FanRef;
  readonly text: string;
  readonly date: string;
  readonly item: {
    readonly itemType: ItemType;
    readonly itemId: string;
    readonly title: string;
    readonly pageName: string;
    readonly artistCredit: string | null;
    readonly artId: string | null;
    readonly itemUrl: string;
  };
};

export type CuratedFeed = {
  readonly boughtByFollowed: readonly FeedItem[];
  readonly newFromPages: readonly FeedItem[];
  readonly inTheirOwnWords: readonly CuratedQuote[];
};

export type UpcomingRelease = {
  readonly itemType: ItemType;
  readonly itemId: string;
  readonly title: string;
  /** As `FeedItem.pageName` and `artistCredit`. */
  readonly pageName: string;
  readonly artistCredit: string | null;
  readonly bandId: string;
  readonly label: string | null;
  readonly tags: readonly FeedTag[];
  readonly artId: string | null;
  readonly itemUrl: string;
  readonly releaseDate: string;
  /** Bandcamp's buyable state: usually true here, and not the same fact as Upcoming. */
  readonly isPreorder: boolean;
  /** Null when no Story of this user's has ever reached this Release. */
  readonly latestStoryDate: string | null;
  readonly buyers: readonly FanRef[];
  readonly wishlisters: readonly FanRef[];
  readonly hasNewRelease: boolean;
  readonly reviews: readonly Review[];
  readonly featuredTrackId: string | null;
  readonly featuredTrackTitle: string | null;
  readonly featuredTrackDuration: number | null;
  readonly numStreamableTracks: number | null;
  /** How many Tracks the release page names, out or not; null until a page is read. */
  readonly numTracks: number | null;
};

/** One Track of a Release, as the player needs it (ADR-0015). */
export type Track = {
  /** Null only on a Track not out, which a phone's page names without an id. */
  readonly trackId: string | null;
  /** 1-based position on the Release. */
  readonly trackNum: number;
  readonly title: string;
  /** Seconds, decimal, from the release page; null when the page omits it. */
  readonly duration: number | null;
  readonly streamUrl: string | null;
  /** Bandcamp caps some previews short; the audio ends where the stream does. */
  readonly capped: boolean;
  /** False for a Track the page names that the label has not let out yet; it never has a stream. */
  readonly out: boolean;
};

export type ReleaseTracks = {
  readonly itemType: ItemType;
  readonly itemId: string;
  /** The Page this Release belongs to. A wishlist write has to name it. */
  readonly bandId: string;
  /** When the release page behind these URLs was fetched. */
  readonly fetchedAt: string;
  /** `fetchedAt` plus 24 hours: the moment the stream URLs die. */
  readonly expiresAt: string;
  readonly tracks: readonly Track[];
};

export type WishlistMembership = {
  readonly itemType: ItemType;
  readonly itemId: string;
  readonly wishlisted: boolean;
  readonly pending: WishlistWriteKind | null;
};

export type WishlistState = {
  readonly items: readonly WishlistMembership[];
};

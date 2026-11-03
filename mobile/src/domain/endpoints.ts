/**
 * Endpoint names exactly as a Raw Document records them, and the envelope shapes the Fetcher writes for each (ADR-0004).
 */
import type { ItemType } from './types';

export const FEED_PAGE_ENDPOINT = 'fan_feed_page';
export const FEED_UPDATES_ENDPOINT = 'fan_dash_feed_updates';
export const WISHLIST_ITEMS_ENDPOINT = 'wishlist_items';
export const RELEASE_PAGE_ENDPOINT = 'release_page';
export const BAND_DETAILS_ENDPOINT = 'band_details';
export const FOLLOWING_BANDS_ENDPOINT = 'following_bands';

export type Endpoint =
  | typeof FEED_PAGE_ENDPOINT
  | typeof FEED_UPDATES_ENDPOINT
  | typeof WISHLIST_ITEMS_ENDPOINT
  | typeof RELEASE_PAGE_ENDPOINT
  | typeof BAND_DETAILS_ENDPOINT
  | typeof FOLLOWING_BANDS_ENDPOINT;

export type ReleaseKey = {
  readonly itemType: ItemType;
  readonly itemId: number;
};

/** `fan_feed_page`: the snapshot poke's page as an extract, never its HTML (ADR-0004 amendment 2026-09-29). */
export type FeedPageEnvelope = {
  readonly url: string;
  readonly status: number;
  readonly bytes: number;
};

/** `release_page`: the key the page was fetched for beside Bandcamp's own blobs. */
export type ReleasePageEnvelope = ReleaseKey & {
  readonly itemUrl: string;
  readonly tralbum: unknown;
  readonly band: unknown;
};

/** `band_details`: the band the fetch was made for, and Bandcamp's JSON untouched. */
export type BandDetailsEnvelope = {
  readonly bandId: number;
  readonly bandDetails: unknown;
};

/** `following_bands`: `snapshotStartedAt` is the walk's start, shared by every page of it (ISO). */
export type FollowingBandsEnvelope = {
  readonly fanId: number;
  readonly page: number;
  readonly snapshotStartedAt: string;
  readonly followingBands: unknown;
  readonly snapshotPage?: SnapshotPage;
};

/** `wishlist_items`: `snapshot_started_at` is the walk's start (ISO). */
export type WishlistItemsEnvelope = {
  readonly url: string;
  readonly snapshot_started_at: string;
  readonly request: unknown;
  readonly response: unknown;
  readonly snapshotPage?: SnapshotPage;
};

/** The source page and request/answer cursors that prove a contiguous membership snapshot. */
export type SnapshotPage = {
  readonly number: number;
  readonly inputToken: string | null;
  readonly nextToken: string | null;
};

/** The `stories` envelope of a feed-updates page, checked only as far as pagination needs. */
export type StoriesEnvelope = {
  readonly entries: readonly unknown[];
  readonly oldestStoryDate: number | null;
  readonly newestStoryDate: number | null;
};

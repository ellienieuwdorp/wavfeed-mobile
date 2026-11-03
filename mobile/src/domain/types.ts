/**
 * The Projection's vocabulary: normalized Fans, Pages, Releases and Stories as plain values (ADR-0004).
 */

export type StoryType = 'purchase' | 'new_release' | 'wishlist';

/** Bandcamp's tralbum discriminator: "a" album, "t" track. */
export type ItemType = 'a' | 't';

export type ReleaseTag = {
  readonly name: string;
  readonly normName: string;
  readonly isLoc: boolean;
};

export type ParsedFan = {
  readonly fanId: number;
  readonly username: string;
  readonly name: string | null;
  readonly location: string | null;
  readonly imageId: number | null;
};

export type ParsedPage = {
  readonly bandId: number;
  readonly name: string;
  readonly url: string | null;
  readonly imageId: number | null;
  readonly genreId: number | null;
};

export type ParsedRelease = {
  readonly itemType: ItemType;
  readonly itemId: number;
  readonly bandId: number;
  readonly title: string;
  readonly url: string;
  readonly albumId: number | null;
  readonly albumTitle: string | null;
  readonly artId: number | null;
  /** Only a new-release Story of a Release that is not a pre-order carries one (ADR-0011, task 0041 decision 1). */
  readonly releaseDate: Date | null;
  readonly label: string | null;
  readonly labelId: number | null;
  /**
   * The feed entry's `band_name`: who the Release is by, which on a label's Page is not the Page's name (task 0071,
   * decision 18). Null when the entry names nobody.
   */
  readonly artistCredit: string | null;
  readonly price: number | null;
  readonly currency: string | null;
  readonly featuredTrackId: number | null;
  readonly featuredTrackTitle: string | null;
  readonly featuredTrackDuration: number | null;
  readonly numStreamableTracks: number | null;
  readonly alsoCollectedCount: number | null;
  readonly isPreorder: boolean;
  readonly tags: readonly ReleaseTag[];
};

/** `fanId` is null for new releases: nobody acted. */
export type ParsedStory = {
  readonly storyType: StoryType;
  readonly fanId: number | null;
  readonly itemType: ItemType;
  readonly itemId: number;
  readonly storyDate: Date;
  readonly reviewText: string | null;
};

export type ParsedReleasePage = {
  readonly itemType: ItemType;
  readonly itemId: number;
  readonly releaseDate: Date | null;
  /** Only album pages state this. */
  readonly isPreorder: boolean | null;
  /** Tracks the page hands a file for; null with the total when the page carries no track list (task 0041, decision 4). */
  readonly numStreamableTracks: number | null;
  readonly numTracks: number | null;
  /** `current.publish_date`: on an album page when it went public; a Track page states its album's (task 0041, decision 7). */
  readonly publishedAt: Date | null;
  /** `current.mod_date`: moves when a Track comes out and on any later edit. */
  readonly modifiedAt: Date | null;
  /** A Track page's album; null on an album page or a Track with no album. */
  readonly album: ParsedTrackAlbum | null;
  /** `tralbum.artist`, which fills a credit no feed entry gave (task 0071, decision 18 and Open 2). */
  readonly artistCredit: string | null;
};

/** What a Track page states about its album, `current.album_id` and the `album_*` fields (task 0067, decision 1). */
export type ParsedTrackAlbum = {
  readonly itemId: number;
  /** `album_url` on the Track page's host; null when the page names none. */
  readonly url: string | null;
  readonly releaseDate: Date | null;
  readonly isPreorder: boolean | null;
};

export type ParsedCatalogRelease = {
  readonly itemType: ItemType;
  readonly itemId: number;
  readonly bandId: number;
  readonly title: string;
  /** Null when the item carried no link; such an item can only enrich a held Release. */
  readonly url: string | null;
  readonly artId: number | null;
  readonly releaseDate: Date | null;
  readonly isPreorder: boolean | null;
};

export type ParsedBandDetails = {
  readonly bandId: number;
  readonly pages: readonly ParsedPage[];
  readonly releases: readonly ParsedCatalogRelease[];
  readonly skipped: SkippedCounts;
};

export type ParsedFollowingBands = {
  readonly fanId: number | null;
  readonly page: number | null;
  /** The walk's start; null on a document that folds additively and sweeps nothing. */
  readonly snapshotStartedAt: Date | null;
  readonly bandIds: readonly number[];
  readonly terminal: boolean;
  readonly skipped: SkippedCounts;
};

export type ParsedWishlistItem = {
  readonly itemType: ItemType;
  readonly itemId: number;
  readonly bandId: number | null;
  readonly addedAt: Date | null;
};

export type ParsedWishlistItems = {
  readonly snapshotStartedAt: Date;
  readonly items: readonly ParsedWishlistItem[];
  /** Only a page Bandcamp said ended the wishlist may sweep. */
  readonly terminal: boolean;
  readonly skipped: SkippedCounts;
};

export type SkippedCounts = {
  readonly unknownStoryType: number;
  readonly unparsable: number;
  readonly missingFanInfo: number;
};

export type MutableSkippedCounts = { -readonly [K in keyof SkippedCounts]: SkippedCounts[K] };

export function noSkips(): MutableSkippedCounts {
  return { unknownStoryType: 0, unparsable: 0, missingFanInfo: 0 };
}

export type ParsedFeedUpdates = {
  readonly fans: readonly ParsedFan[];
  readonly pages: readonly ParsedPage[];
  readonly releases: readonly ParsedRelease[];
  readonly stories: readonly ParsedStory[];
  readonly skipped: SkippedCounts;
};

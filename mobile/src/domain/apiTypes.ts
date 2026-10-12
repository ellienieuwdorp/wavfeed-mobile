/**
 * The view response shapes the phone's screens render.
 * Ported from server/packages/core/src/apiTypes.ts (task 0036).
 */

/** What happened, in CONTEXT.md vocabulary. Wire codes never reach clients. */
export type ApiStoryType = 'purchase' | 'new_release' | 'wishlist';

/** Bandcamp's tralbum kinds: `a` for an album, `t` for a standalone track. */
export type ApiItemType = 'a' | 't';

/** A Fan referenced from a signal: enough to name them and draw an avatar. */
export type ApiFanRef = {
  readonly fanId: string;
  readonly username: string;
  readonly name: string | null;
  /** Bandcamp image id for `f4.bcbits.com/img/<imageId>_42.jpg`; null means initials. */
  readonly imageId: string | null;
};

/** A feed tag on a Release: `normName` matches, `name` is shown. Places are never one (task 0071, decision 7). */
export type ApiTag = {
  readonly name: string;
  readonly normName: string;
};

/** Review text a Fan wrote alongside a purchase (the wire's `why` field). */
export type ApiReview = {
  readonly fan: ApiFanRef;
  readonly text: string;
};

export type ApiFeedItem = {
  readonly kind: 'item';
  readonly itemType: ApiItemType;
  readonly itemId: string;
  readonly title: string;
  /** The name of the Release's Page, which is a label's as often as the artist's (task 0071, decision 18). */
  readonly pageName: string;
  /** Who the Release is by; null when nothing credited anyone. `creditLine` (credit.ts) puts the two together. */
  readonly artistCredit: string | null;
  readonly bandId: string;
  readonly label: string | null;
  readonly tags: readonly ApiTag[];
  /** Bandcamp art id for `f4.bcbits.com/img/a<artId>_<size>.jpg`; null means placeholder. */
  readonly artId: string | null;
  readonly itemUrl: string;
  /** Known only once a new-release Story carried it (see schema notes). */
  readonly releaseDate: string | null;
  readonly latestStoryDate: string;
  readonly anchorDate: string;
  readonly buyers: readonly ApiFanRef[];
  readonly wishlisters: readonly ApiFanRef[];
  readonly hasNewRelease: boolean;
  readonly reviews: readonly ApiReview[];
  readonly featuredTrackId: string | null;
  readonly featuredTrackTitle: string | null;
  readonly featuredTrackDuration: number | null;
  readonly numStreamableTracks: number | null;
  /** How many Tracks the release page names, out or not; null until a page is read (task 0041, decision 4). */
  readonly numTracks: number | null;
  /** New releases leaves an undated pre-order to its page (task 0041, decision 1). */
  readonly isPreorder: boolean;
  /** New releases places it on its release day, not its anchor (task 0041, decision 3; `FeedStoryRow.onReleaseDay`). */
  readonly onReleaseDay: boolean;
};

/** One member of a Burst, enough for the expanded mini rows. */
export type ApiBurstItem = {
  readonly itemType: ApiItemType;
  readonly itemId: string;
  readonly title: string;
  readonly pageName: string;
  readonly artistCredit: string | null;
  readonly artId: string | null;
  readonly itemUrl: string;
  readonly storyDate: string;
};

export type ApiBurst = {
  readonly kind: 'burst';
  readonly fan: ApiFanRef;
  readonly storyCount: number;
  readonly storyType: ApiStoryType | 'mixed';
  readonly latestStoryDate: string;
  readonly anchorDate: string;
  readonly items: readonly ApiBurstItem[];
};

export type ApiFeedElement = ApiFeedItem | ApiBurst;

export type ApiFeedSort = 'activity' | 'anchor';

/** Our own account, as the client sees it. Never carries credential material. */
export type ApiUser = {
  readonly username: string;
  readonly displayName: string | null;
  readonly avatarUrl: string | null;
};

/** A quote for the Curated Feed's 'In their own words' module. */
export type ApiCuratedQuote = {
  readonly fan: ApiFanRef;
  readonly text: string;
  readonly date: string;
  readonly item: {
    readonly itemType: ApiItemType;
    readonly itemId: string;
    readonly title: string;
    readonly pageName: string;
    readonly artistCredit: string | null;
    readonly artId: string | null;
    readonly itemUrl: string;
  };
};

export type ApiCuratedResponse = {
  readonly boughtByFollowed: readonly ApiFeedItem[];
  readonly newFromPages: readonly ApiFeedItem[];
  readonly inTheirOwnWords: readonly ApiCuratedQuote[];
};

export type ApiUpcomingRelease = {
  readonly itemType: ApiItemType;
  readonly itemId: string;
  readonly title: string;
  /** As `ApiFeedItem.pageName` and `artistCredit` (task 0071, decision 18). */
  readonly pageName: string;
  readonly artistCredit: string | null;
  readonly bandId: string;
  readonly label: string | null;
  readonly tags: readonly ApiTag[];
  readonly artId: string | null;
  readonly itemUrl: string;
  readonly releaseDate: string;
  /** Bandcamp's buyable state: usually true here, and not the same fact as Upcoming. */
  readonly isPreorder: boolean;
  /** Null when no Story of this user's has ever reached this Release. */
  readonly latestStoryDate: string | null;
  readonly buyers: readonly ApiFanRef[];
  readonly wishlisters: readonly ApiFanRef[];
  readonly hasNewRelease: boolean;
  readonly reviews: readonly ApiReview[];
  readonly featuredTrackId: string | null;
  readonly featuredTrackTitle: string | null;
  readonly featuredTrackDuration: number | null;
  readonly numStreamableTracks: number | null;
  /** How many Tracks the release page names, out or not; null until a page is read (task 0041, decision 4). */
  readonly numTracks: number | null;
};

export type ApiUpcomingResponse = {
  readonly releases: readonly ApiUpcomingRelease[];
};

/** One Track of a Release, as the player needs it (ADR-0015). */
export type ApiReleaseTrack = {
  /** Null only on a Track not out, which a phone's page names without an id (task 0041, decision 5). */
  readonly trackId: string | null;
  /** 1-based position on the Release. */
  readonly trackNum: number;
  readonly title: string;
  /** Seconds, decimal, from the release page; null when the page omits it. */
  readonly duration: number | null;
  readonly streamUrl: string | null;
  /** Bandcamp caps some previews short; the audio ends where the stream does. */
  readonly capped: boolean;
  /** False for a Track the page names that the label has not let out yet; it never has a stream (task 0041, decision 5). */
  readonly out: boolean;
};

export type ApiReleaseTracksResponse = {
  readonly itemType: ApiItemType;
  readonly itemId: string;
  /** The Page this Release belongs to. A wishlist write has to name it. */
  readonly bandId: string;
  /** When the release page behind these URLs was fetched. */
  readonly fetchedAt: string;
  /** `fetchedAt` plus 24 hours: the moment the stream URLs die. */
  readonly expiresAt: string;
  readonly tracks: readonly ApiReleaseTrack[];
};

/** Adding to the Bandcamp wishlist, or taking it back off (ADR-0016). */
export type ApiWishlistActionKind = 'add' | 'remove';

export type ApiWishlistActionStatus = 'pending' | 'running' | 'done' | 'failed';

/** Why a press did not reach Bandcamp. The UI turns each into one sentence. */
export type ApiWishlistFailure =
  | 'cookie_dead'
  | 'bandcamp_rejected'
  | 'bandcamp_unreachable'
  | 'seal_key_unavailable';

export type ApiWishlistAction = {
  readonly id: string;
  readonly itemType: ApiItemType;
  readonly itemId: string;
  readonly action: ApiWishlistActionKind;
  readonly status: ApiWishlistActionStatus;
  /** Set only when `status` is `failed`. */
  readonly failure: ApiWishlistFailure | null;
  readonly createdAt: string;
  readonly finishedAt: string | null;
};

export type ApiWishlistItem = {
  readonly itemType: ApiItemType;
  readonly itemId: string;
  readonly wishlisted: boolean;
  readonly pending: ApiWishlistActionKind | null;
};

export type ApiWishlistResponse = {
  readonly items: readonly ApiWishlistItem[];
};

/**
 * The view response shapes the web renders, kept so the phone renders exactly what the web does; seen and starred are always false here.
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
  /** The Page's name. Called artist in the UI ('Title · Artist'). */
  readonly artist: string;
  readonly bandId: string;
  readonly label: string | null;
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
  readonly seen: boolean;
  readonly starred: boolean;
  readonly featuredTrackId: string | null;
  readonly featuredTrackTitle: string | null;
  readonly featuredTrackDuration: number | null;
  readonly numStreamableTracks: number | null;
};

/** One member of a Burst, enough for the expanded mini rows. */
export type ApiBurstItem = {
  readonly itemType: ApiItemType;
  readonly itemId: string;
  readonly title: string;
  readonly artist: string;
  readonly artId: string | null;
  readonly itemUrl: string;
  readonly storyDate: string;
  readonly seen: boolean;
  readonly starred: boolean;
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

export type ApiFeedView = 'unseen' | 'everything' | 'starred';
export type ApiFeedSort = 'activity' | 'anchor';

export type ApiFeedMeta = {
  /** Distinct Releases in the current view scope with at least one Story of the type. */
  readonly typeCounts: Readonly<Record<ApiStoryType, number>>;
  /** Global unseen Feed Item count, view-independent (sidebar and meta line). */
  readonly unseenCount: number;
  /** When this user's data was last refreshed; the UI says 'updated N min ago'. */
  readonly updatedAt: string | null;
};

export type ApiFeedResponse = {
  readonly elements: readonly ApiFeedElement[];
  /** Opaque; pass back as `cursor` for the next page. Null means the end. */
  readonly nextCursor: string | null;
  readonly meta: ApiFeedMeta;
};

/** Our own account, as the client sees it. Never carries credential material. */
export type ApiUser = {
  readonly username: string;
  readonly displayName: string | null;
  readonly avatarUrl: string | null;
};

export type ApiOverviewResponse = {
  /** When this user's data was last refreshed; the sidebar says 'updated N min ago'. */
  readonly updatedAt: string | null;
  readonly unseenCount: number;
  /** Unseen Releases carrying a new-release Story: the New releases view's sidebar count. */
  readonly newReleaseUnseenCount: number;
  readonly starredCount: number;
  /** Rendered next to 'All pages' in the sidebar. */
  readonly pageCount: number;
  readonly user: ApiUser;
};

export type ApiBoughtWeek = {
  /** ISO date of the week's Monday. Weeks with no entries never appear. */
  readonly weekStart: string;
  readonly entries: readonly ApiFeedItem[];
};

export type ApiBoughtResponse = {
  readonly weeks: readonly ApiBoughtWeek[];
  /** Opaque; pass back as `cursor` for older weeks. Null means the end. */
  readonly nextCursor: string | null;
};

export type ApiBoughtCrossedEntry = {
  readonly item: ApiFeedItem;
  readonly crossedAt: string;
};

export type ApiBoughtCrossedResponse = {
  readonly entries: readonly ApiBoughtCrossedEntry[];
  /** Opaque; pass back as `cursor` for older crossings. Null means the end. */
  readonly nextCursor: string | null;
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
    readonly artist: string;
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
  /** The Page's name. Called artist in the UI ('Title · Artist'). */
  readonly artist: string;
  readonly bandId: string;
  readonly label: string | null;
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
  readonly seen: boolean;
  readonly starred: boolean;
  readonly featuredTrackId: string | null;
  readonly featuredTrackTitle: string | null;
  readonly featuredTrackDuration: number | null;
  readonly numStreamableTracks: number | null;
};

export type ApiUpcomingResponse = {
  readonly releases: readonly ApiUpcomingRelease[];
};

/** One Track of a Release, as the player needs it (ADR-0015). */
export type ApiReleaseTrack = {
  readonly trackId: string;
  /** 1-based position on the Release. */
  readonly trackNum: number;
  readonly title: string;
  /** Seconds, decimal, from the release page; null when the page omits it. */
  readonly duration: number | null;
  readonly streamUrl: string | null;
  /** Bandcamp caps some previews short; the audio ends where the stream does. */
  readonly capped: boolean;
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

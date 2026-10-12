/**
 * What a gather turn writes through, so the turn owns the order of requests and the store owns where they land
 * (task 0036, decisions 2 and 4). Every response enters through `putRaw` before anything reads it (ADR-0004), and
 * everything the screen shows about gathering is a field of `GatherState`.
 */
import type { BandcampDocument, Identity } from '../bandcamp/wire';
import type { ReleaseKey } from '../domain/endpoints';
import type { DueRelease, OwedTrackPage, ReleaseDateCounts, ReleasePageOutcome, UndatedRelease } from '../store/enrichment';

export type WalkKind = 'feed_walk' | 'feed_poll';

/** One feed answer with entries: its newest and oldest Story dates, unix seconds, and how many Stories it held. */
export type StorySample = { readonly newest: number; readonly oldest: number; readonly count: number };

/**
 * The Extension's walk (extension/lib/storage.ts) less its server fields. Unix seconds: `olderThan` is the next
 * cursor, `sinceTs` the server's stop line, `newestSeen` the next stop line once this walk finishes. The depth probe
 * (task 0040) runs once per first walk: `floor` is the oldest Story it proved, where the walk should end, and
 * `probeOldest` the oldest Story of each answer it got with entries. A walk stored before task 0040 reads as not
 * probed, with no floor. `samples` and `recent` are what the fill estimates the Stories still to come from (task 0040,
 * decision 5): each probe answer with entries, and the walk's own last pages. A walk stored before that decision has
 * no `samples` until the turn reads them from the Raw Documents the probe landed.
 */
export type WalkState = {
  readonly kind: WalkKind;
  readonly fanId: number;
  readonly username: string | null;
  readonly olderThan: number;
  readonly pagesDone: number;
  readonly dedupedRun: number;
  readonly maxPages: number;
  readonly poked: boolean;
  readonly startedAt: number;
  readonly sinceTs: number | null;
  readonly newestSeen: number | null;
  readonly probed: boolean;
  readonly floor: number | null;
  readonly probeOldest: readonly number[];
  /** Where a probe cut short by the budget or a sign-out goes on searching from; absent until one is. */
  readonly probeLower?: number;
  readonly samples?: readonly StorySample[];
  /** The walk's last `RATE_PAGES` pages with entries, oldest last. */
  readonly recent?: readonly StorySample[];
};

export type PausedReason = 'logged_out' | 'not_connected';

/** A code, never a message (ADR-0003). `other_fan`: the probe answered as a Fan this store does not belong to. */
export type GatherFailure = 'bandcamp_unreachable' | 'bandcamp_error' | 'store_error' | 'other_fan';

/** Thrown from `patchGatherState` when the probe answers as a Fan this store does not belong to (`other_fan`). */
export class ForeignFanError extends Error {
  constructor() {
    super('a different Fan is signed in');
  }
}

export type GatherPhase = 'idle' | 'probing' | 'walking' | 'lists' | 'sweeping' | 'dating';

/** Epoch milliseconds, but `newestStoryDate` is unix seconds. `not_connected` means no probe has answered as a Fan. */
export type GatherState = {
  readonly identity: Identity | null;
  readonly pausedReason: PausedReason | null;
  readonly lastError: GatherFailure | null;
  /** Written with `lastError`: a `bandcamp_error`'s status, 0 when no HTTP status explains it; else null. */
  readonly lastStatus: number | null;
  readonly lastTurnAt: number | null;
  readonly lastSuccessAt: number | null;
  readonly initialWalkDone: boolean;
  readonly storiesSoFar: number;
  readonly phase: GatherPhase;
  readonly newestStoryDate: number | null;
  readonly followsFetchedAt: number | null;
  /** Last follow-list attempt, separate from completed-read freshness (task 0070). */
  readonly followsAskedAt: number | null;
  readonly wishlistFetchedAt: number | null;
  /** When the wishlist was last asked, whatever it answered; hearts take presses from the first ask on. */
  readonly wishlistAskedAt: number | null;
  /** Releases a Story or a wishlist item reaches, with and without a release date, as the last turn left them. */
  readonly releasesDated: number;
  readonly releasesUndated: number;
};

export const EMPTY_GATHER_STATE: GatherState = {
  identity: null,
  pausedReason: null,
  lastError: null,
  lastStatus: null,
  lastTurnAt: null,
  lastSuccessAt: null,
  initialWalkDone: false,
  storiesSoFar: 0,
  phase: 'idle',
  newestStoryDate: null,
  followsFetchedAt: null,
  followsAskedAt: null,
  wishlistFetchedAt: null,
  wishlistAskedAt: null,
  releasesDated: 0,
  releasesUndated: 0,
};

export type GatherSink = {
  putRaw(doc: BandcampDocument): Promise<{ deduped: boolean }>;
  readWalk(): Promise<WalkState | null>;
  /** Feed answers with entries landed since `sinceMs` whose oldest Story is older than `below` (task 0040, decision 5). */
  readFeedSamples(sinceMs: number, below: number): Promise<readonly StorySample[]>;
  writeWalk(w: WalkState | null): Promise<void>;
  readGatherState(): Promise<GatherState>;
  patchGatherState(p: Partial<GatherState>): Promise<void>;
  readFollowedBands(): Promise<{ bandId: number; name: string }[]>;
  /** Never-swept first. */
  readSweepDue(nowMs: number, limit: number): Promise<{ bandId: number }[]>;
  /** The store books the Page's next visit from the band details `putRaw` last held for it (ADR-0017). */
  markSwept(bandId: number, nowMs: number, ok: boolean): Promise<void>;
  afterDocuments(): Promise<void>;
  /** Undated Releases whose page is due a visit, newest Story first (ADR-0011). */
  readUndatedReleases(nowMs: number, limit: number): Promise<readonly UndatedRelease[]>;
  /** Upcoming Releases whose page is due a read again, for a Drop (task 0041, decision 8). */
  readUpcomingDue(nowMs: number, limit: number): Promise<readonly DueRelease[]>;
  /** Track pages a Drop still owes, which date it (task 0041, decisions 7 and 8). */
  readOwedTrackPages(nowMs: number, limit: number): Promise<readonly OwedTrackPage[]>;
  /** The newest release page payload held for a Release, or null: what a new page's Tracks are compared against. */
  readReleasePage(key: ReleaseKey): Promise<unknown>;
  markReleasePageAttempt(key: ReleaseKey, outcome: ReleasePageOutcome, nowMs: number): Promise<void>;
  readReleaseDateCounts(): Promise<ReleaseDateCounts>;
};

/**
 * One gather turn in the foreground (task 0036, decision 4): probe; while a walk is pending (the first walk, or a held
 * feed walk), the wishlist and the follow list when six hours old, then a small band details sweep of due followed
 * Pages (ADR-0017), so hearts and Upcoming hold truth while the history fills; before a first walk's first page, a
 * depth probe that binary searches the feed's `older_than` cursor for the oldest Story (task 0040); the feed walk or
 * poll with the Extension's rules (extension/lib/poll.ts) plus the server's stop line (feed.ts); once caught up, the
 * lists when due come after the feed, so a pull reads the feed first (task 0046, decision 1); public pages rotating
 * undated Releases (ADR-0011), owed Drop Tracks and due Upcoming Releases (task 0072), a few while walking, with time
 * held back for all three queues. A Track page can add its due future parent to the Upcoming queue after its fold,
 * and a new Drop adds Track work to the owed queue; then the rest of the sweep. A list that fails is noted and the
 * turn goes on; a feed page or a depth
 * probe Bandcamp answers with an error fails the turn before any step after the feed, since a 403, 429 or 5xx asks for
 * fewer requests (ADR-0017); any other answer that is not a page asks the probe first and, signed in, the same request
 * once more (task 0066, decision 2). The cursor is written after every page, so a turn out of budget or killed with the
 * app resumes for free, and the store folds after every batch while the walk runs. `lastSuccessAt` names the last read of
 * the feed: it moves once per turn, when the feed step ends `done` or `pending`, to the moment its last feed answer
 * landed (task 0046, decision 2), and a pull to refresh lets its spinner go when it moves (state/refresh.ts).
 */
import type { BandcampSession } from '../bandcamp/session';
import { parseReleasePage } from '../domain/parseReleasePage';
import { type BandcampAnswer, type BandcampDocument, type Identity, originOf, refusedOrDown } from '../bandcamp/wire';
import { FEED_UPDATES_ENDPOINT, type ReleaseKey } from '../domain/endpoints';
import type { DueRelease, OwedTrackPage } from '../store/enrichment';
import { GATHER_INTERVAL_MS } from './cadence';
import { ForeignFanError, type GatherFailure, type GatherSink, type GatherState, type StorySample, type WalkState } from './sink';
import { bandDetailsBreaker, SWEEP_TURN_MAX } from './sweep';

export type GatherSession = Pick<
  BandcampSession,
  | 'probeIdentity'
  | 'pokeFeedPage'
  | 'fetchFeedUpdates'
  | 'fetchFollowingBands'
  | 'fetchWishlistItems'
  | 'fetchBandDetails'
  | 'fetchReleasePage'
>;

export type GatherReason = 'open' | 'refresh' | 'timer';

export type GatherOptions = {
  readonly now: () => number;
  readonly reason: GatherReason;
  readonly budgetMs: number;
  /** A new pull may retry incomplete lists; its chain continuations retain the attempt gate (task 0070). */
  readonly bypassListAttemptGate?: boolean;
  /** The pause before the feed's one retry; a timer unless a test passes its own clock. */
  readonly wait?: (ms: number) => Promise<void>;
};

export type TurnOutcome = 'done' | 'out_of_budget' | 'paused' | 'failed';

/** The request whose answer failed the turn (task 0066, decision 1). */
export type FailedStep = 'probe' | 'feed_poke' | 'feed_page' | 'depth_probe';

export type TurnSummary = {
  readonly reason: GatherReason;
  readonly outcome: TurnOutcome;
  readonly walkPending: boolean;
  /** A failed turn's `lastStatus`: the status of the Bandcamp error that ended it, 0 when none explains it; else null. */
  readonly status: number | null;
  /** A failed turn's request; null for any other turn, or one the store ended. */
  readonly failedStep: FailedStep | null;
  /** Whether a feed request was asked again after the probe said signed in (task 0066, decision 2). */
  readonly feedRetried: boolean;
};

/** The Extension's PAGES_PER_TURN: with no five-minute kill here, the batch between folds; the budget ends a turn. */
export const PAGES_PER_BATCH = 5;
export const DEDUP_STOP_RUN = 2;
/**
 * ceiling: a first walk, or a poll that ran past its cap, ends after 500 feed pages and marks the walk done, so a feed
 * deeper than that never gathers its oldest Stories and nothing says so (review FLOW-17). The upgrade ends a walk only on
 * the feed's last page, with the chain's stall rule (task 0040) as the guard against a feed that never ends.
 */
export const WALK_MAX_PAGES = 500;
export const POLL_MAX_PAGES = 10;
export const LIST_INTERVAL_MS = 6 * 60 * 60 * 1000;
/** Due Pages swept before the feed while the first walk is pending; the rest of `SWEEP_TURN_MAX` follows the feed. */
export const PRE_WALK_SWEEP = 6;
/** Release pages per turn while the first walk is pending, and once it is done. */
export const RELEASE_PAGES_WALKING = 5;
export const RELEASE_PAGES_CAUGHT_UP = 25;
/** Held back from the walk per queued release page: the pacing gap and a slow answer. */
export const RELEASE_PAGE_RESERVE_MS = 2_000;
/** The depth probe (task 0040): requests per first walk, the date it starts from and how close it gets. */
export const DEPTH_PROBE_MAX = 8;
/** 2008-01-01 UTC, before Bandcamp's feed existed. */
export const DEPTH_PROBE_LOWER = 1199145600;
export const DEPTH_PROBE_RESOLUTION_S = 30 * 24 * 60 * 60;
/** The walk's own last pages its rate at the cursor is read over (task 0040, decision 5). */
export const RATE_PAGES = 5;
/** The pause before a feed request is asked again: time for the snapshot the poke asked for (unconfirmed, task 0066). */
export const FEED_RETRY_AFTER_MS = 5_000;

type Ctx = {
  readonly session: GatherSession;
  readonly sink: GatherSink;
  readonly now: () => number;
  readonly budgetMs: number;
  readonly bypassListAttemptGate: boolean;
  deadline: number;
  /**
   * When this turn's last feed answer landed, a `fan_dash_feed_updates` page or a depth probe answer; published as
   * `lastSuccessAt` once the feed step ends `done` or `pending` (task 0046, decision 2).
   */
  feedReadAt: number | null;
  readonly wait: (ms: number) => Promise<void>;
  /** Set once a suspect feed answer has asked the probe, which a turn does once. */
  rechecked: boolean;
  feedRetried: boolean;
  failedStep: FailedStep | null;
};

type Step = 'go' | 'paused' | 'unreachable';
type FeedEnd = 'done' | 'pending' | 'error' | Exclude<Step, 'go'>;

let turnInFlight: Promise<TurnSummary> | null = null;

/** One turn at a time; a second caller shares the turn already running. */
export function runGatherTurn(
  session: GatherSession,
  sink: GatherSink,
  options: GatherOptions,
): Promise<TurnSummary> {
  if (turnInFlight !== null) return turnInFlight;
  turnInFlight = turn(session, sink, options).finally(() => {
    turnInFlight = null;
  });
  return turnInFlight;
}

async function turn(session: GatherSession, sink: GatherSink, options: GatherOptions): Promise<TurnSummary> {
  const ctx: Ctx = {
    session,
    sink,
    now: options.now,
    budgetMs: options.budgetMs,
    bypassListAttemptGate: options.bypassListAttemptGate ?? options.reason === 'refresh',
    deadline: options.now() + options.budgetMs,
    feedReadAt: null,
    wait: options.wait ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms))),
    rechecked: false,
    feedRetried: false,
    failedStep: null,
  };
  let summary: TurnSummary;
  try {
    const outcome = await gather(ctx);
    const counts = await sink.readReleaseDateCounts();
    await sink.patchGatherState({ releasesDated: counts.dated, releasesUndated: counts.undated });
    const after = await sink.readGatherState();
    summary = {
      reason: options.reason,
      outcome,
      walkPending: !after.initialWalkDone || (await sink.readWalk()) !== null,
      status: outcome === 'failed' ? after.lastStatus : null,
      failedStep: outcome === 'failed' ? ctx.failedStep : null,
      feedRetried: ctx.feedRetried,
    };
    await sink.patchGatherState({ phase: 'idle' });
  } catch (error) {
    // The sink threw: a store message, never a Bandcamp body (the session returns values).
    console.warn('gather turn stopped on the store:', error instanceof Error ? error.message : String(error));
    await sink.patchGatherState({ lastError: 'store_error', lastStatus: null, phase: 'idle' }).catch(() => undefined);
    summary = { reason: options.reason, outcome: 'failed', walkPending: false, status: null, failedStep: null, feedRetried: ctx.feedRetried };
  }
  return summary;
}

/**
 * iOS freezes JS in the background, so a turn can wake long past its deadline: its budget restarts from the wake.
 * `reserveMs` ends a step early, keeping that much for the steps after it.
 */
function outOfBudget(ctx: Ctx, reserveMs = 0): boolean {
  const at = ctx.now();
  if (at - ctx.deadline > ctx.budgetMs) ctx.deadline = at + ctx.budgetMs;
  return at >= ctx.deadline - reserveMs;
}

async function note(ctx: Ctx, failure: GatherFailure, status: number | null = null): Promise<void> {
  await ctx.sink.patchGatherState({ lastError: failure, lastStatus: status });
}

type Refusal = Exclude<BandcampAnswer<unknown>, { kind: 'ok' }>;

/** One line per answer that is not ok, for device checks: its kind and status, never a header or a body (ADR-0003). */
function warnAnswer(what: string, answer: Refusal): void {
  console.warn(`${what} answered ${answer.kind}${answer.kind === 'error' ? ` ${answer.status}` : ''}`);
}

/** `step` names a request whose failure fails the turn; the lists' failures do not. */
async function settle(ctx: Ctx, what: string, answer: Refusal, step?: FailedStep): Promise<FeedEnd> {
  warnAnswer(what, answer);
  if (answer.kind === 'logged_out') {
    await ctx.sink.patchGatherState({ pausedReason: 'logged_out' });
    return 'paused';
  }
  if (step !== undefined) ctx.failedStep = step;
  if (answer.kind === 'unreachable') {
    await note(ctx, 'bandcamp_unreachable');
    return 'unreachable';
  }
  await note(ctx, 'bandcamp_error', answer.status);
  return 'error';
}

/**
 * Not a page and not a refusal: a body that is not JSON, which the session reads as signed out, or a status other than
 * a 403, 429 or 5xx. A dead session answers the feed with a bare 400 (task 0066).
 */
function suspect(answer: BandcampAnswer<unknown>): answer is Refusal {
  return answer.kind === 'logged_out' || (answer.kind === 'error' && !refusedOrDown(answer.status));
}

/** A suspect answer the probe did not explain is Bandcamp's error; 0 when no HTTP status explains it (ADR-0003). */
function unexplained(answer: Refusal): Refusal {
  return answer.kind === 'logged_out' ? { kind: 'error', status: 0 } : answer;
}

/**
 * A feed request asked through the probe (task 0066, decision 2): a suspect answer asks the probe, so only the probe
 * pauses a turn as signed out; signed in, the request is asked once more after FEED_RETRY_AFTER_MS. Once per turn, so a
 * turn adds at most two requests; a refusal is never asked again (ADR-0017).
 */
async function askFeed<T>(ctx: Ctx, ask: () => Promise<BandcampAnswer<T>>): Promise<BandcampAnswer<T>> {
  const answer = await ask();
  if (!suspect(answer)) return answer;
  if (ctx.rechecked) return unexplained(answer);
  ctx.rechecked = true;
  warnAnswer('feed request before the recheck', answer);
  const probe = await ctx.session.probeIdentity();
  if (probe.kind !== 'ok') return probe;
  await ctx.wait(FEED_RETRY_AFTER_MS);
  ctx.feedRetried = true;
  const again = await ask();
  return suspect(again) ? unexplained(again) : again;
}

async function store(ctx: Ctx, doc: BandcampDocument): Promise<boolean> {
  const { deduped } = await ctx.sink.putRaw(doc);
  // The walk's pages and the depth probe's answers share the endpoint; the poke's page does not (task 0046, decision 2).
  if (doc.endpoint === FEED_UPDATES_ENDPOINT) ctx.feedReadAt = ctx.now();
  return deduped;
}

async function gather(ctx: Ctx): Promise<TurnOutcome> {
  const { session, sink } = ctx;
  const before = await sink.readGatherState();
  await sink.patchGatherState({ lastTurnAt: ctx.now(), phase: 'probing' });

  const probe = await session.probeIdentity();
  if (probe.kind === 'logged_out') {
    // The probe answered, so no failure stands; `gather_finished` reads `lastError` as this turn's (task 0038).
    await sink.patchGatherState({
      pausedReason: before.identity === null ? 'not_connected' : 'logged_out',
      lastError: null,
      lastStatus: null,
    });
    return 'paused';
  }
  if (probe.kind === 'unreachable') {
    ctx.failedStep = 'probe';
    await note(ctx, 'bandcamp_unreachable');
    return 'failed';
  }
  if (probe.kind === 'error') {
    ctx.failedStep = 'probe';
    await note(ctx, 'bandcamp_error', probe.status);
    return 'failed';
  }

  const identity = probe.value;
  const otherFan = before.identity !== null && before.identity.fanId !== identity.fanId;
  try {
    await sink.patchGatherState({
      identity,
      pausedReason: null,
      lastError: null,
      lastStatus: null,
      // A different Fan signed in: nothing gathered for the last one speaks for this one.
      ...(otherFan
        ? { initialWalkDone: false, storiesSoFar: 0, newestStoryDate: null, followsFetchedAt: null, followsAskedAt: null, wishlistFetchedAt: null, wishlistAskedAt: null }
        : {}),
    });
  } catch (error) {
    if (!(error instanceof ForeignFanError)) throw error;
    // The sink has paused the store as logged out, so the signed-out notice asks for this store's Fan again.
    await note(ctx, 'other_fan');
    return 'paused';
  }

  const state = await sink.readGatherState();
  const held = await sink.readWalk();
  const walkPending = !state.initialWalkDone || held?.kind === 'feed_walk';
  // While a walk is pending the lists come first, as the sweep before the walk reads only followed Pages; a caught-up
  // turn reads the feed first and the lists after it (task 0046, decision 1). An unreachable list is noted and left
  // for the next turn; the steps behind it still run.
  if (walkPending && (await runLists(ctx, identity)) === 'paused') return 'paused';
  const swept = walkPending && !outOfBudget(ctx) ? await runSweep(ctx, PRE_WALK_SWEEP) : 0;

  // A poll is a few pages, so only a walk, which spends the whole budget, holds time back for release pages.
  const dating = walkPending ? RELEASE_PAGES_WALKING : RELEASE_PAGES_CAUGHT_UP;
  const queued = walkPending
    ? Math.min(dating, new Set((await releasePageQueues(ctx, dating)).flat().map((page) => `${page.key.itemType}:${page.key.itemId}`)).size)
    : 0;
  const feed = await runFeed(ctx, identity, queued * RELEASE_PAGE_RESERVE_MS);
  if (feed === 'paused') return 'paused';
  if (feed === 'unreachable' || feed === 'error') return 'failed';
  if (ctx.feedReadAt !== null) await sink.patchGatherState({ lastSuccessAt: ctx.feedReadAt });

  if (!walkPending && (await runLists(ctx, identity)) === 'paused') return 'paused';
  if (!outOfBudget(ctx)) await runReleasePages(ctx, dating);
  if (!outOfBudget(ctx)) await runSweep(ctx, SWEEP_TURN_MAX - swept);
  return feed === 'pending' || outOfBudget(ctx) ? 'out_of_budget' : 'done';
}

function planWalk(state: GatherState, identity: Identity, nowMs: number): WalkState {
  const walk = !state.initialWalkDone;
  return {
    kind: walk ? 'feed_walk' : 'feed_poll',
    fanId: identity.fanId,
    username: identity.username,
    olderThan: Math.floor(nowMs / 1000),
    pagesDone: 0,
    dedupedRun: 0,
    maxPages: walk ? WALK_MAX_PAGES : POLL_MAX_PAGES,
    poked: false,
    startedAt: nowMs,
    sinceTs: walk ? null : state.newestStoryDate,
    newestSeen: null,
    // A poll never probes (task 0040).
    probed: !walk,
    floor: null,
    probeOldest: [],
    samples: [],
    recent: [],
  };
}

function sampleOf(count: number, oldest: number | null, newest: number | null): StorySample | null {
  return count > 0 && oldest !== null && newest !== null ? { newest, oldest, count } : null;
}

async function runFeed(ctx: Ctx, identity: Identity, reserveMs: number): Promise<FeedEnd> {
  const { session, sink } = ctx;
  const state = await sink.readGatherState();
  const resumed = await sink.readWalk();
  let walk = resumed !== null && resumed.fanId === identity.fanId ? resumed : planWalk(state, identity, ctx.now());
  const catchingUp = !state.initialWalkDone;
  // A first walk probed before task 0040's decision 5 reads its samples once from the answers the probe landed.
  if (walk.kind === 'feed_walk' && walk.samples === undefined) {
    walk = { ...walk, samples: await sink.readFeedSamples(walk.startedAt, walk.olderThan) };
  }
  let storiesSoFar = resumed === null ? 0 : state.storiesSoFar;

  await sink.writeWalk(walk);
  await sink.patchGatherState({ phase: 'walking', ...(catchingUp ? { storiesSoFar } : {}) });

  if (!walk.poked) {
    if (walk.username !== null) {
      if (outOfBudget(ctx, reserveMs)) return 'pending';
      const username = walk.username;
      const poke = await askFeed(ctx, () => session.pokeFeedPage(username));
      if (poke.kind !== 'ok') return await settle(ctx, 'feed poke', poke, 'feed_poke');
      await store(ctx, poke.value);
    }
    walk = { ...walk, poked: true };
    await sink.writeWalk(walk);
  }

  if (catchingUp && walk.kind === 'feed_walk' && !walk.probed) {
    if (outOfBudget(ctx, reserveMs)) return 'pending';
    const probed = await probeDepth(ctx, walk, reserveMs);
    if (typeof probed === 'string') return probed;
    walk = probed;
  }

  let sinceFold = 0;
  for (;;) {
    if (walk.pagesDone >= walk.maxPages) {
      // A poll capped short of what we hold keeps walking, so it leaves no gap (audit B1).
      if (walk.kind === 'feed_poll' && walk.sinceTs !== null) {
        walk = { ...walk, kind: 'feed_walk', maxPages: walk.pagesDone + WALK_MAX_PAGES };
        await sink.writeWalk(walk);
        continue;
      }
      return await finishWalk(ctx, walk);
    }
    if (outOfBudget(ctx, reserveMs)) {
      await sink.afterDocuments();
      return 'pending';
    }

    const { fanId, olderThan } = walk;
    const page = await askFeed(ctx, () => session.fetchFeedUpdates(fanId, olderThan));
    if (page.kind !== 'ok') {
      await sink.afterDocuments();
      return await settle(ctx, 'feed page', page, 'feed_page');
    }

    const { entryCount, oldestStoryDate: oldest, newestStoryDate } = page.value;
    const deduped = await store(ctx, page.value.document);
    // A page the depth probe already landed is new to the walk: it counts, and neither extends nor breaks a dedup run
    // (task 0040). Its bytes match the probe's when the probe's cursor fell in the gap above that page. Its date leaves
    // `probeOldest` before the count is written, so a turn killed before the cursor moves does not count it again.
    const probedPage = deduped && oldest !== null && walk.probeOldest.includes(oldest);
    if (probedPage) {
      walk = { ...walk, probeOldest: walk.probeOldest.filter((date) => date !== oldest) };
      await sink.writeWalk(walk);
    }
    if (catchingUp && (!deduped || probedPage)) {
      storiesSoFar += entryCount;
      await sink.patchGatherState({ storiesSoFar });
    }

    const sample = sampleOf(entryCount, oldest, newestStoryDate);
    walk = {
      ...walk,
      ...(sample === null ? {} : { recent: [...(walk.recent ?? []), sample].slice(-RATE_PAGES) }),
      pagesDone: walk.pagesDone + 1,
      dedupedRun: probedPage ? walk.dedupedRun : deduped ? walk.dedupedRun + 1 : 0,
      newestSeen:
        newestStoryDate === null ? walk.newestSeen : Math.max(walk.newestSeen ?? newestStoryDate, newestStoryDate),
    };

    const reachedKnown =
      // Nothing left down there, or no cursor to ask the next page with.
      entryCount === 0 ||
      oldest === null ||
      // Bandcamp replayed the same window; following it loops to the cap.
      oldest >= walk.olderThan ||
      // Already held: the walk has reached what we have.
      walk.dedupedRun >= DEDUP_STOP_RUN ||
      // Older than the newest Story a finished walk reached (server feed.ts, stop condition 3).
      (walk.sinceTs !== null && oldest <= walk.sinceTs);
    if (oldest === null || reachedKnown) {
      await sink.writeWalk(walk);
      return await finishWalk(ctx, walk);
    }

    walk = { ...walk, olderThan: oldest };
    await sink.writeWalk(walk);
    sinceFold += 1;
    if (sinceFold >= PAGES_PER_BATCH) {
      sinceFold = 0;
      await sink.afterDocuments();
    }
  }
}

/**
 * The depth probe (task 0040): the feed's answers carry no total, but `older_than` takes any time, so a binary search
 * from DEPTH_PROBE_LOWER to the walk's cursor finds the oldest Story to within DEPTH_PROBE_RESOLUTION_S. An empty
 * answer raises the lower bound, an answer with entries lowers the upper one to its oldest Story, and anything else
 * ends the search. Each answer lands as a Raw Document (ADR-0004) and the Projection folds its Stories, but the walk's
 * count and cursor are left to the walk; an answer with entries is kept as a sample for the fill (decision 5). The
 * walk is marked probed whatever the search found, except when the budget, a signed-out answer or a Bandcamp error
 * cuts it short: the bounds, dates and samples found so far are kept, and the next turn searches on between them. A
 * Bandcamp error fails the turn as a feed page's does (ADR-0017).
 */
async function probeDepth(ctx: Ctx, walk: WalkState, reserveMs: number): Promise<WalkState | FeedEnd> {
  let lo = walk.probeLower ?? DEPTH_PROBE_LOWER;
  let known = walk.floor;
  const probeOldest = [...walk.probeOldest];
  const samples = [...(walk.samples ?? [])];
  let stored = false;
  let cut: 'budget' | Refusal | null = null;

  const wide = () => (known ?? walk.olderThan) - lo > DEPTH_PROBE_RESOLUTION_S;
  for (let asked = probeOldest.length; asked < DEPTH_PROBE_MAX && wide(); asked += 1) {
    if (outOfBudget(ctx, reserveMs)) {
      cut = 'budget';
      break;
    }
    const cursor = Math.floor((lo + (known ?? walk.olderThan)) / 2);
    const answer = await askFeed(ctx, () => ctx.session.fetchFeedUpdates(walk.fanId, cursor));
    if (answer.kind === 'logged_out' || answer.kind === 'error') {
      cut = answer;
      break;
    }
    // An offline phone fails the walk's first page too, which is where the turn notes it.
    if (answer.kind !== 'ok') {
      warnAnswer('depth probe', answer);
      break;
    }

    await store(ctx, answer.value.document);
    stored = true;
    const { entryCount, oldestStoryDate: oldest, newestStoryDate } = answer.value;
    if (entryCount === 0) lo = cursor;
    else if (oldest !== null && oldest < cursor) {
      known = Math.min(known ?? oldest, oldest);
      probeOldest.push(oldest);
      const sample = sampleOf(entryCount, oldest, newestStoryDate);
      if (sample !== null) samples.push(sample);
    } else break;
  }

  const probed: WalkState = { ...walk, probed: cut === null, floor: known, probeOldest, samples, probeLower: lo };
  await ctx.sink.writeWalk(probed);
  if (stored) await ctx.sink.afterDocuments();
  if (cut !== null && cut !== 'budget') return await settle(ctx, 'depth probe', cut, 'depth_probe');
  return probed;
}

async function finishWalk(ctx: Ctx, walk: WalkState): Promise<FeedEnd> {
  const state = await ctx.sink.readGatherState();
  const newest =
    walk.newestSeen === null
      ? state.newestStoryDate
      : Math.max(state.newestStoryDate ?? walk.newestSeen, walk.newestSeen);
  await ctx.sink.writeWalk(null);
  await ctx.sink.patchGatherState({ initialWalkDone: true, newestStoryDate: newest });
  await ctx.sink.afterDocuments();
  return 'done';
}

function isDue(fetchedAt: number | null, nowMs: number): boolean {
  return fetchedAt === null || nowMs - fetchedAt >= LIST_INTERVAL_MS;
}

/** Incomplete reads stay due, with automatic attempts spaced by the gather cadence (task 0070, decision 4). */
function listDue(ctx: Ctx, fetchedAt: number | null, askedAt: number | null): boolean {
  return isDue(fetchedAt, ctx.now()) &&
    (ctx.bypassListAttemptGate || askedAt === null || ctx.now() - askedAt >= GATHER_INTERVAL_MS);
}

async function runLists(ctx: Ctx, identity: Identity): Promise<Step> {
  const { session, sink } = ctx;
  const state = await sink.readGatherState();
  let wrote = false;
  const onDocument = async (doc: BandcampDocument): Promise<void> => {
    await store(ctx, doc);
    wrote = true;
  };
  await sink.patchGatherState({ phase: 'lists' });

  // The wishlist first: until it answers once, every heart is not asked yet.
  if (listDue(ctx, state.wishlistFetchedAt, state.wishlistAskedAt) && !outOfBudget(ctx)) {
    const wishlist = await session.fetchWishlistItems(identity.fanId, onDocument);
    if (wishlist.kind === 'ok') {
      // An admitted partial walk enables hearts, but only a complete read starts the six-hour gate (task 0070).
      await sink.patchGatherState({ wishlistAskedAt: ctx.now(), ...(wishlist.value.complete ? { wishlistFetchedAt: ctx.now() } : {}) });
    } else {
      const end = await settle(ctx, 'wishlist walk', wishlist);
      if (end === 'paused') return finishLists(ctx, wrote, end);
      await sink.patchGatherState({ wishlistAskedAt: ctx.now() });
      if (end === 'unreachable') return finishLists(ctx, wrote, end);
    }
  }

  // The follow page is addressed by handle; a Fan Bandcamp did not name waits for one.
  if (identity.username !== null && listDue(ctx, state.followsFetchedAt, state.followsAskedAt) && !outOfBudget(ctx)) {
    const follows = await session.fetchFollowingBands(identity.fanId, identity.username, onDocument);
    await sink.patchGatherState({ followsAskedAt: ctx.now() });
    if (follows.kind === 'ok') {
      if (follows.value.complete) await sink.patchGatherState({ followsFetchedAt: ctx.now() });
    } else if ((await settle(ctx, 'follows', follows)) === 'unreachable') return finishLists(ctx, wrote, 'unreachable');
  }
  return finishLists(ctx, wrote, 'go');
}

async function finishLists(ctx: Ctx, wrote: boolean, step: Step): Promise<Step> {
  if (wrote) await ctx.sink.afterDocuments();
  return step;
}

function namesReleaseDate(payload: unknown): boolean {
  try {
    return parseReleasePage(payload).releaseDate !== null;
  } catch {
    return false;
  }
}

/** Books a refused answer: only a page's own 4xx counts against it, as an offline phone, a 429 or a 5xx says nothing about it. */
async function refused(ctx: Ctx, what: string, key: ReleaseKey, answer: Refusal): Promise<void> {
  if (answer.kind === 'error' && answer.status < 500 && answer.status !== 429) {
    await ctx.sink.markReleasePageAttempt(key, 'failed', ctx.now());
  }
  warnAnswer(what, answer);
}

/** One public page, stored before anything reads it and booked in the attempts; `refused` ends the pass. */
async function readPublicPage(ctx: Ctx, what: string, url: string, key: ReleaseKey): Promise<BandcampDocument | 'none' | 'refused'> {
  const answer = await ctx.session.fetchReleasePage(url, key);
  if (answer.kind !== 'ok') {
    await refused(ctx, what, key, answer);
    return 'refused';
  }
  const page = answer.value;
  if (page.kind !== 'page') {
    await ctx.sink.markReleasePageAttempt(key, page.kind, ctx.now());
    return 'none';
  }
  await store(ctx, page.document);
  await ctx.sink.markReleasePageAttempt(key, namesReleaseDate(page.document.payload) ? 'dated' : 'undated', ctx.now());
  return page.document;
}

/** A page due this pass, addressed by the source's URL or Track path. */
type DuePage = { readonly what: string; readonly url: string; readonly key: ReleaseKey };
type ReleasePageQueues = [DuePage[], DuePage[], DuePage[]];

function release(due: DueRelease): DuePage {
  return { what: 'release page', url: due.url, key: { itemType: due.itemType, itemId: due.itemId } };
}

function tracks(owed: readonly OwedTrackPage[]): DuePage[] {
  return owed.flatMap((track) => {
    const origin = originOf(track.releaseUrl);
    const key: ReleaseKey = { itemType: track.itemType, itemId: track.itemId };
    return origin === null ? [] : [{ what: 'track page', url: `${origin}${track.path}`, key }];
  });
}

/** The same due queues govern the walk's reserved time and the bounded enrichment pass (task 0072). */
async function releasePageQueues(ctx: Ctx, quota: number): Promise<ReleasePageQueues> {
  const undated = await ctx.sink.readUndatedReleases(ctx.now(), quota);
  const owed = await ctx.sink.readOwedTrackPages(ctx.now(), quota);
  const upcoming = await ctx.sink.readUpcomingDue(ctx.now(), quota);
  return [undated.map(release), tracks(owed), upcoming.map(release)];
}

/**
 * Up to `quota` public pages, rotating undated Releases, owed Drop Tracks and Upcoming Releases (task 0072). Each page
 * lands and folds before newly owed Tracks or its due parent album enter their queues, so dependent work shares the
 * allowance without crowding out planned pages. The store's attempt book gates every dependency too. A page left by
 * quota or budget stays due next pass; one refused request ends the pass (ADR-0001, task 0041, decisions 7 and 8).
 */
async function runReleasePages(ctx: Ctx, quota: number): Promise<void> {
  const { sink } = ctx;
  const queues = await releasePageQueues(ctx, quota);
  if (queues.every((queue) => queue.length === 0)) return;
  await sink.patchGatherState({ phase: 'dating' });
  let asked = 0;
  let next = 0;
  const requested = new Set<string>();
  const keyOf = (key: ReleaseKey): string => `${key.itemType}:${key.itemId}`;
  const enqueue = (queue: DuePage[], page: DuePage, first = false): void => {
    const key = keyOf(page.key);
    if (requested.has(key)) return;
    for (const held of queues) {
      const index = held.findIndex((pending) => keyOf(pending.key) === key);
      if (index < 0) continue;
      if (!first) return;
      // Fresh Track evidence promotes the existing parent using its current canonical due page (task 0072).
      held.splice(index, 1);
    }
    if (first) queue.unshift(page);
    else queue.push(page);
  };

  while (asked < quota && !outOfBudget(ctx)) {
    let page: DuePage | undefined;
    for (let checked = 0; checked < queues.length && page === undefined; checked += 1) {
      const queue = queues[next]!;
      next = (next + 1) % queues.length;
      while (queue.length > 0 && page === undefined) {
        const candidate = queue.shift()!;
        if (!requested.has(keyOf(candidate.key))) page = candidate;
      }
    }
    if (page === undefined) break;
    requested.add(keyOf(page.key));
    asked += 1;
    const read = await readPublicPage(ctx, page.what, page.url, page.key);
    if (read === 'refused') break;
    if (read === 'none') continue;
    await sink.afterDocuments();
    if (page.key.itemType === 'a') {
      for (const track of tracks(await sink.readOwedTrackPages(ctx.now(), quota, page.key.itemId))) enqueue(queues[1], track);
    } else {
      let album: ReturnType<typeof parseReleasePage>['album'];
      try { album = parseReleasePage(read.payload).album; }
      catch { continue; }
      if (album === null || album.url === null || album.releaseDate === null) continue;
      for (const parent of await sink.readUpcomingDue(ctx.now(), 1, { itemType: 'a', itemId: album.itemId })) {
        enqueue(queues[2], release(parent), true);
      }
    }
  }
}

/** Up to `quota` due followed Pages; answers how many were asked, so the turn can spend the rest later. */
async function runSweep(ctx: Ctx, quota: number): Promise<number> {
  const { session, sink } = ctx;
  if (quota <= 0 || bandDetailsBreaker.isOpen(ctx.now())) return 0;
  await sink.patchGatherState({ phase: 'sweeping' });

  // Only Pages the Fan follows are swept (ADR-0017), whatever the queue holds.
  const followed = new Set((await sink.readFollowedBands()).map((band) => band.bandId));
  const due = (await sink.readSweepDue(ctx.now(), SWEEP_TURN_MAX))
    .filter((band) => followed.has(band.bandId))
    .slice(0, quota);
  let wrote = false;
  let asked = 0;

  for (const band of due) {
    if (outOfBudget(ctx) || bandDetailsBreaker.isOpen(ctx.now())) break;
    asked += 1;
    const answer = await session.fetchBandDetails(band.bandId);
    const at = ctx.now();

    if (answer.kind === 'ok') {
      bandDetailsBreaker.recordSuccess();
      if (answer.value.kind === 'details') {
        await store(ctx, answer.value.document);
        wrote = true;
      }
      await sink.markSwept(band.bandId, at, true);
      continue;
    }

    await sink.markSwept(band.bandId, at, false);
    const status = answer.kind === 'error' ? answer.status : 0;
    const opened = bandDetailsBreaker.recordFailure(at, status);
    if (answer.kind === 'unreachable') {
      await note(ctx, 'bandcamp_unreachable');
      break;
    }
    if (opened) {
      await note(ctx, 'bandcamp_error', status);
      break;
    }
  }
  if (wrote) await sink.afterDocuments();
  return asked;
}

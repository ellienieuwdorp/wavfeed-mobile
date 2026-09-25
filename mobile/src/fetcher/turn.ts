/**
 * One gather turn in the foreground (task 0036, decision 4): probe; the wishlist and the follow list when six hours
 * old; while the first walk is pending a small band details sweep of due followed Pages (ADR-0017), so hearts and
 * Upcoming hold truth while the history fills; the feed walk or poll with the Extension's rules (extension/lib/poll.ts)
 * plus the server's stop line (feed.ts); then the rest of the sweep. A list that fails is noted and the walk still
 * runs. The cursor is written after every page, so a turn out of budget or killed with the app resumes for free, and
 * the store folds after every batch while the walk runs.
 */
import type { BandcampSession } from '../bandcamp/session';
import type { BandcampAnswer, BandcampDocument, Identity } from '../bandcamp/wire';
import type { GatherFailure, GatherSink, GatherState, SweepTier, WalkState } from './sink';
import {
  bandDetailsBreaker,
  failureBackoffMs,
  nextDueFor,
  readDiscographyDates,
  SWEEP_TURN_MAX,
  tierFor,
} from './sweep';

export type GatherSession = Pick<
  BandcampSession,
  | 'probeIdentity'
  | 'pokeFeedPage'
  | 'fetchFeedUpdates'
  | 'fetchFollowingBands'
  | 'fetchWishlistItems'
  | 'fetchBandDetails'
>;

export type GatherReason = 'open' | 'refresh' | 'timer';

export type GatherOptions = {
  readonly now: () => number;
  readonly reason: GatherReason;
  readonly budgetMs: number;
  readonly random?: () => number;
};

export type TurnOutcome = 'done' | 'out_of_budget' | 'paused' | 'failed';

export type TurnSummary = {
  readonly reason: GatherReason;
  readonly outcome: TurnOutcome;
  readonly walkPending: boolean;
};

/** The Extension's PAGES_PER_TURN: with no five-minute kill here, the batch between folds; the budget ends a turn. */
export const PAGES_PER_BATCH = 5;
export const DEDUP_STOP_RUN = 2;
export const WALK_MAX_PAGES = 500;
export const POLL_MAX_PAGES = 10;
export const LIST_INTERVAL_MS = 6 * 60 * 60 * 1000;
/** Due Pages swept before the feed while the first walk is pending; the rest of `SWEEP_TURN_MAX` follows the feed. */
export const PRE_WALK_SWEEP = 6;

type Ctx = {
  readonly session: GatherSession;
  readonly sink: GatherSink;
  readonly now: () => number;
  readonly budgetMs: number;
  deadline: number;
  readonly random: () => number;
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
    deadline: options.now() + options.budgetMs,
    random: options.random ?? Math.random,
  };
  let summary: TurnSummary;
  try {
    const outcome = await gather(ctx);
    const after = await sink.readGatherState();
    summary = { reason: options.reason, outcome, walkPending: !after.initialWalkDone || (await sink.readWalk()) !== null };
    await sink.patchGatherState({ phase: 'idle' });
  } catch (error) {
    // The sink threw: a store message, never a Bandcamp body (the session returns values).
    console.warn('gather turn stopped on the store:', error instanceof Error ? error.message : String(error));
    await sink.patchGatherState({ lastError: 'store_error', phase: 'idle' }).catch(() => undefined);
    summary = { reason: options.reason, outcome: 'failed', walkPending: false };
  }
  return summary;
}

/** iOS freezes JS in the background, so a turn can wake long past its deadline: its budget restarts from the wake. */
function outOfBudget(ctx: Ctx): boolean {
  const at = ctx.now();
  if (at - ctx.deadline > ctx.budgetMs) ctx.deadline = at + ctx.budgetMs;
  return at >= ctx.deadline;
}

async function note(ctx: Ctx, failure: GatherFailure): Promise<void> {
  await ctx.sink.patchGatherState({ lastError: failure });
}

async function settle(ctx: Ctx, answer: Exclude<BandcampAnswer<unknown>, { kind: 'ok' }>): Promise<FeedEnd> {
  if (answer.kind === 'logged_out') {
    await ctx.sink.patchGatherState({ pausedReason: 'logged_out' });
    return 'paused';
  }
  if (answer.kind === 'unreachable') {
    await note(ctx, 'bandcamp_unreachable');
    return 'unreachable';
  }
  await note(ctx, 'bandcamp_error');
  return 'error';
}

async function store(ctx: Ctx, doc: BandcampDocument): Promise<boolean> {
  const { deduped } = await ctx.sink.putRaw(doc);
  await ctx.sink.patchGatherState({ lastSuccessAt: ctx.now() });
  return deduped;
}

async function gather(ctx: Ctx): Promise<TurnOutcome> {
  const { session, sink } = ctx;
  const before = await sink.readGatherState();
  await sink.patchGatherState({ lastTurnAt: ctx.now(), phase: 'probing' });

  const probe = await session.probeIdentity();
  if (probe.kind === 'logged_out') {
    await sink.patchGatherState({ pausedReason: before.identity === null ? 'not_connected' : 'logged_out' });
    return 'paused';
  }
  if (probe.kind !== 'ok') {
    await note(ctx, probe.kind === 'unreachable' ? 'bandcamp_unreachable' : 'bandcamp_error');
    return 'failed';
  }

  const identity = probe.value;
  const otherFan = before.identity !== null && before.identity.fanId !== identity.fanId;
  await sink.patchGatherState({
    identity,
    pausedReason: null,
    lastError: null,
    // A different Fan signed in: nothing gathered for the last one speaks for this one.
    ...(otherFan
      ? { initialWalkDone: false, storiesSoFar: 0, newestStoryDate: null, followsFetchedAt: null, wishlistFetchedAt: null, wishlistAskedAt: null }
      : {}),
  });

  // An unreachable list is noted and left for the next turn; the walk behind it still runs.
  if ((await runLists(ctx, identity)) === 'paused') return 'paused';

  const state = await sink.readGatherState();
  const held = await sink.readWalk();
  const walkPending = !state.initialWalkDone || held?.kind === 'feed_walk';
  const swept = walkPending && !outOfBudget(ctx) ? await runSweep(ctx, PRE_WALK_SWEEP) : 0;

  const feed = await runFeed(ctx, identity);
  if (feed === 'paused') return 'paused';
  if (feed === 'unreachable') return 'failed';

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
  };
}

async function runFeed(ctx: Ctx, identity: Identity): Promise<FeedEnd> {
  const { session, sink } = ctx;
  const state = await sink.readGatherState();
  const resumed = await sink.readWalk();
  let walk = resumed !== null && resumed.fanId === identity.fanId ? resumed : planWalk(state, identity, ctx.now());
  const catchingUp = !state.initialWalkDone;
  let storiesSoFar = resumed === null ? 0 : state.storiesSoFar;

  await sink.writeWalk(walk);
  await sink.patchGatherState({ phase: 'walking', ...(catchingUp ? { storiesSoFar } : {}) });

  if (!walk.poked) {
    if (walk.username !== null) {
      if (outOfBudget(ctx)) return 'pending';
      const poke = await session.pokeFeedPage(walk.username);
      if (poke.kind !== 'ok') return await settle(ctx, poke);
      await store(ctx, poke.value);
    }
    walk = { ...walk, poked: true };
    await sink.writeWalk(walk);
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
    if (outOfBudget(ctx)) {
      await sink.afterDocuments();
      return 'pending';
    }

    const page = await session.fetchFeedUpdates(walk.fanId, walk.olderThan);
    if (page.kind !== 'ok') {
      await sink.afterDocuments();
      return await settle(ctx, page);
    }

    const { entryCount, oldestStoryDate: oldest, newestStoryDate } = page.value;
    const deduped = await store(ctx, page.value.document);
    if (catchingUp && !deduped) {
      storiesSoFar += entryCount;
      await sink.patchGatherState({ storiesSoFar });
    }

    walk = {
      ...walk,
      pagesDone: walk.pagesDone + 1,
      dedupedRun: deduped ? walk.dedupedRun + 1 : 0,
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
  if (isDue(state.wishlistFetchedAt, ctx.now()) && !outOfBudget(ctx)) {
    const wishlist = await session.fetchWishlistItems(identity.fanId, onDocument);
    if (wishlist.kind === 'ok') await sink.patchGatherState({ wishlistFetchedAt: ctx.now(), wishlistAskedAt: ctx.now() });
    else {
      console.warn(`wishlist walk answered ${wishlist.kind}${wishlist.kind === 'error' ? ` ${wishlist.status}` : ''}`);
      const end = await settle(ctx, wishlist);
      if (end === 'paused') return finishLists(ctx, wrote, end);
      await sink.patchGatherState({ wishlistAskedAt: ctx.now() });
      if (end === 'unreachable') return finishLists(ctx, wrote, end);
    }
  }

  // The follow page is addressed by handle; a Fan Bandcamp did not name waits for one.
  if (identity.username !== null && isDue(state.followsFetchedAt, ctx.now()) && !outOfBudget(ctx)) {
    const follows = await session.fetchFollowingBands(identity.fanId, identity.username, onDocument);
    if (follows.kind === 'ok') await sink.patchGatherState({ followsFetchedAt: ctx.now() });
    else if ((await settle(ctx, follows)) === 'unreachable') return finishLists(ctx, wrote, 'unreachable');
  }
  return finishLists(ctx, wrote, 'go');
}

async function finishLists(ctx: Ctx, wrote: boolean, step: Step): Promise<Step> {
  if (wrote) await ctx.sink.afterDocuments();
  return step;
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
      let tier: SweepTier = 'cold';
      if (answer.value.kind === 'details') {
        await store(ctx, answer.value.document);
        wrote = true;
        tier = tierFor(readDiscographyDates(answer.value.bandDetails), at);
      }
      await sink.markSwept(band.bandId, at, true, { tier, nextDueAt: nextDueFor(tier, at, ctx.random), failures: 0 });
      continue;
    }

    const failures = (band.failures ?? 0) + 1;
    await sink.markSwept(band.bandId, at, false, { tier: null, nextDueAt: at + failureBackoffMs(failures), failures });
    const opened = bandDetailsBreaker.recordFailure(at, answer.kind === 'error' ? answer.status : 0);
    if (opened || answer.kind === 'unreachable') {
      await note(ctx, answer.kind === 'unreachable' ? 'bandcamp_unreachable' : 'bandcamp_error');
      break;
    }
  }
  if (wrote) await sink.afterDocuments();
  return asked;
}

/**
 * One gather turn in the foreground (task 0036, decision 4): probe; the wishlist and the follow list when six hours
 * old; while the first walk is pending a small band details sweep of due followed Pages (ADR-0017), so hearts and
 * Upcoming hold truth while the history fills; before a first walk's first page, a depth probe that binary searches the
 * feed's `older_than` cursor for the oldest Story (task 0040); the feed walk or poll with the Extension's rules
 * (extension/lib/poll.ts) plus the server's stop line (feed.ts); public release pages for undated Releases (ADR-0011),
 * a few while the walk is pending, with budget held back from the walk for them; then the rest of the sweep. A list
 * that fails is noted and the walk still runs; a feed page or a depth probe Bandcamp answers with an error fails the
 * turn before the release pages and the rest of the sweep, since a 403, 429 or 5xx asks for fewer requests
 * (ADR-0017). The cursor is written after every page, so a turn out of budget or killed with the app resumes for free,
 * and the store folds after every batch while the walk runs. `lastSuccessAt` moves once the feed step ends and again
 * when the turn does, never per answer: a pull to refresh lets its spinner go when it moves (state/refresh.ts).
 */
import type { BandcampSession } from '../bandcamp/session';
import { parseReleasePage } from '../domain/parseReleasePage';
import type { BandcampAnswer, BandcampDocument, Identity } from '../bandcamp/wire';
import { ForeignFanError, type GatherFailure, type GatherSink, type GatherState, type WalkState } from './sink';
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
};

export type TurnOutcome = 'done' | 'out_of_budget' | 'paused' | 'failed';

export type TurnSummary = {
  readonly reason: GatherReason;
  readonly outcome: TurnOutcome;
  readonly walkPending: boolean;
  /** A failed turn's `lastStatus`: the status of the Bandcamp error that ended it, 0 when none explains it; else null. */
  readonly status: number | null;
};

/** The Extension's PAGES_PER_TURN: with no five-minute kill here, the batch between folds; the budget ends a turn. */
export const PAGES_PER_BATCH = 5;
export const DEDUP_STOP_RUN = 2;
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

type Ctx = {
  readonly session: GatherSession;
  readonly sink: GatherSink;
  readonly now: () => number;
  readonly budgetMs: number;
  deadline: number;
  /** When this turn's last Raw Document landed; published as `lastSuccessAt` after the feed and at the turn's end. */
  landedAt: number | null;
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
    landedAt: null,
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
    };
    await sink.patchGatherState({ phase: 'idle', ...landed(ctx) });
  } catch (error) {
    // The sink threw: a store message, never a Bandcamp body (the session returns values).
    console.warn('gather turn stopped on the store:', error instanceof Error ? error.message : String(error));
    await sink.patchGatherState({ lastError: 'store_error', lastStatus: null, phase: 'idle', ...landed(ctx) }).catch(() => undefined);
    summary = { reason: options.reason, outcome: 'failed', walkPending: false, status: null };
  }
  return summary;
}

function landed(ctx: Ctx): Partial<GatherState> {
  return ctx.landedAt === null ? {} : { lastSuccessAt: ctx.landedAt };
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

async function settle(ctx: Ctx, what: string, answer: Refusal): Promise<FeedEnd> {
  warnAnswer(what, answer);
  if (answer.kind === 'logged_out') {
    await ctx.sink.patchGatherState({ pausedReason: 'logged_out' });
    return 'paused';
  }
  if (answer.kind === 'unreachable') {
    await note(ctx, 'bandcamp_unreachable');
    return 'unreachable';
  }
  await note(ctx, 'bandcamp_error', answer.status);
  return 'error';
}

async function store(ctx: Ctx, doc: BandcampDocument): Promise<boolean> {
  const { deduped } = await ctx.sink.putRaw(doc);
  ctx.landedAt = ctx.now();
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
    await note(ctx, 'bandcamp_unreachable');
    return 'failed';
  }
  if (probe.kind === 'error') {
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
        ? { initialWalkDone: false, storiesSoFar: 0, newestStoryDate: null, followsFetchedAt: null, wishlistFetchedAt: null, wishlistAskedAt: null }
        : {}),
    });
  } catch (error) {
    if (!(error instanceof ForeignFanError)) throw error;
    // The sink has paused the store as logged out, so the signed-out notice asks for this store's Fan again.
    await note(ctx, 'other_fan');
    return 'paused';
  }

  // An unreachable list is noted and left for the next turn; the walk behind it still runs.
  if ((await runLists(ctx, identity)) === 'paused') return 'paused';

  const state = await sink.readGatherState();
  const held = await sink.readWalk();
  const walkPending = !state.initialWalkDone || held?.kind === 'feed_walk';
  const swept = walkPending && !outOfBudget(ctx) ? await runSweep(ctx, PRE_WALK_SWEEP) : 0;

  // A poll is a few pages, so only a walk, which spends the whole budget, holds time back for release pages.
  const dating = walkPending ? RELEASE_PAGES_WALKING : RELEASE_PAGES_CAUGHT_UP;
  const queued = walkPending ? (await sink.readUndatedReleases(ctx.now(), dating)).length : 0;
  const feed = await runFeed(ctx, identity, queued * RELEASE_PAGE_RESERVE_MS);
  if (feed === 'paused') return 'paused';
  if (feed === 'unreachable' || feed === 'error') return 'failed';
  if (ctx.landedAt !== null) await sink.patchGatherState({ lastSuccessAt: ctx.landedAt });

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
  };
}

async function runFeed(ctx: Ctx, identity: Identity, reserveMs: number): Promise<FeedEnd> {
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
      if (outOfBudget(ctx, reserveMs)) return 'pending';
      const poke = await session.pokeFeedPage(walk.username);
      if (poke.kind !== 'ok') return await settle(ctx, 'feed poke', poke);
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

    const page = await session.fetchFeedUpdates(walk.fanId, walk.olderThan);
    if (page.kind !== 'ok') {
      await sink.afterDocuments();
      return await settle(ctx, 'feed page', page);
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

    walk = {
      ...walk,
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
 * count and cursor are left to the walk. The walk is marked probed whatever the search found, except when the budget,
 * a signed-out answer or a Bandcamp error cuts it short: the bounds and dates found so far are kept, and the next turn
 * searches on between them. A Bandcamp error fails the turn as a feed page's does (ADR-0017).
 */
async function probeDepth(ctx: Ctx, walk: WalkState, reserveMs: number): Promise<WalkState | FeedEnd> {
  let lo = walk.probeLower ?? DEPTH_PROBE_LOWER;
  let known = walk.floor;
  const probeOldest = [...walk.probeOldest];
  let stored = false;
  let cut: 'budget' | Refusal | null = null;

  const wide = () => (known ?? walk.olderThan) - lo > DEPTH_PROBE_RESOLUTION_S;
  for (let asked = probeOldest.length; asked < DEPTH_PROBE_MAX && wide(); asked += 1) {
    if (outOfBudget(ctx, reserveMs)) {
      cut = 'budget';
      break;
    }
    const cursor = Math.floor((lo + (known ?? walk.olderThan)) / 2);
    const answer = await ctx.session.fetchFeedUpdates(walk.fanId, cursor);
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
    const { entryCount, oldestStoryDate: oldest } = answer.value;
    if (entryCount === 0) lo = cursor;
    else if (oldest !== null && oldest < cursor) {
      known = Math.min(known ?? oldest, oldest);
      probeOldest.push(oldest);
    } else break;
  }

  const probed: WalkState = { ...walk, probed: cut === null, floor: known, probeOldest, probeLower: lo };
  await ctx.sink.writeWalk(probed);
  if (stored) await ctx.sink.afterDocuments();
  if (cut !== null && cut !== 'budget') return await settle(ctx, 'depth probe', cut);
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
      const end = await settle(ctx, 'wishlist walk', wishlist);
      if (end === 'paused') return finishLists(ctx, wrote, end);
      await sink.patchGatherState({ wishlistAskedAt: ctx.now() });
      if (end === 'unreachable') return finishLists(ctx, wrote, end);
    }
  }

  // The follow page is addressed by handle; a Fan Bandcamp did not name waits for one.
  if (identity.username !== null && isDue(state.followsFetchedAt, ctx.now()) && !outOfBudget(ctx)) {
    const follows = await session.fetchFollowingBands(identity.fanId, identity.username, onDocument);
    if (follows.kind === 'ok') await sink.patchGatherState({ followsFetchedAt: ctx.now() });
    else if ((await settle(ctx, 'follows', follows)) === 'unreachable') return finishLists(ctx, wrote, 'unreachable');
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

/**
 * Up to `quota` public release pages of undated Releases, each stored before it is read; the Projection folds the date
 * in. One failed request ends the pass, as the server's enrichment does (ADR-0001).
 */
async function runReleasePages(ctx: Ctx, quota: number): Promise<void> {
  const { session, sink } = ctx;
  const due = await sink.readUndatedReleases(ctx.now(), quota);
  if (due.length === 0) return;
  await sink.patchGatherState({ phase: 'dating' });
  let wrote = false;

  for (const release of due) {
    if (outOfBudget(ctx)) break;
    const key = { itemType: release.itemType, itemId: release.itemId };
    const answer = await session.fetchReleasePage(release.url, key);
    if (answer.kind !== 'ok') {
      // An offline phone, a 429 or a 5xx says nothing about the page, so only its own answers count against it.
      if (answer.kind === 'error' && answer.status < 500 && answer.status !== 429) {
        await sink.markReleasePageAttempt(key, 'failed', ctx.now());
      }
      warnAnswer('release page', answer);
      break;
    }
    const page = answer.value;
    if (page.kind !== 'page') {
      await sink.markReleasePageAttempt(key, page.kind, ctx.now());
      continue;
    }
    await store(ctx, page.document);
    wrote = true;
    await sink.markReleasePageAttempt(key, namesReleaseDate(page.document.payload) ? 'dated' : 'undated', ctx.now());
  }
  if (wrote) await sink.afterDocuments();
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

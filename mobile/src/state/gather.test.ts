/// <reference types="node" />
/**
 * The runner's chain of turns (task 0040) through the real turn, sink and store, against a Bandcamp whose feed pages
 * each cost the clock ten seconds, so a minute's turn walks a handful of pages. An unreachable page costs a minute and
 * fails the turn with no status, so it takes the retry, whose wait the mocked clock jumps; a status fails the turn
 * with no retry (ADR-0017). The app state's hooks module is stood in here, since Node cannot load its TSX; keep awake and the
 * foreground state come from test/register.mjs, and the foreground state is the one `react-native` export these tests move.
 * Each chain's Tallies (task 0038) are collected from the runner's `track`.
 */
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { afterEach, beforeEach, mock, test } from 'node:test';
import type { SQLiteDatabase } from 'expo-sqlite';

import { FAN_ID, feedPayload, purchaseAt } from '../../test/fixtures';
import { openTestStore } from '../../test/nodeDb';
import type { FeedUpdatesPage } from '../bandcamp/session';
import type { BandcampAnswer, Identity } from '../bandcamp/wire';
import { loadDemo } from '../demo/demo';
import type { GatherState, WalkState } from '../fetcher/sink';
import type { GatherReason, GatherSession } from '../fetcher/turn';
import { readKv } from '../store';
import type { Tally } from '../tally/catalogue';
import type { RunnerDeps } from './appState';
import { GATHER_KEY, patchGather, WALK_KEY } from './gatherSink';

const stub = (source: string) => ({ url: `data:text/javascript,${encodeURIComponent(source)}`, shortCircuit: true });
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === './appState' && context.parentURL?.endsWith('/state/gather.ts')) return stub('export function useAppState() {}');
    return next(specifier, context);
  },
});
const { FAILED_RETRIES, runner, STALL_TURNS } = await import('./gather');
const { AppState: foreground } = (await import('react-native')) as unknown as { AppState: { currentState: string } };

const START = Date.UTC(2026, 8, 25, 12, 0, 0);
const PAGE_SIZE = 5;
const REQUEST_MS = 10_000;
const FAN: Identity = { fanId: FAN_ID, username: 'diggerfan' };

let db: SQLiteDatabase;
let close: () => void;
let turns: number;
let identity: BandcampAnswer<Identity>;
let feed: { readonly itemId: number; readonly at: number }[];
let feedPage: (olderThan: number) => BandcampAnswer<FeedUpdatesPage> | Promise<BandcampAnswer<FeedUpdatesPage>>;
/** Turns whose identity probe answers after a minute, so the budget is spent before the walk. */
let slowProbe: (turn: number) => boolean;
let tallies: Tally[];

const ok = <T>(value: T): BandcampAnswer<T> => ({ kind: 'ok', value });
const at = (): string => new Date(Date.now()).toISOString();

function servedPage(olderThan: number): BandcampAnswer<FeedUpdatesPage> {
  const page = feed.filter((story) => story.at < olderThan).slice(0, PAGE_SIZE);
  const dates = page.map((story) => story.at);
  return ok({
    document: { endpoint: 'fan_dash_feed_updates', payload: feedPayload({ entries: page.map((story) => purchaseAt(story.itemId, story.at)) }), fetchedAt: at() },
    entryCount: page.length,
    oldestStoryDate: page.length === 0 ? null : Math.min(...dates),
    newestStoryDate: page.length === 0 ? null : Math.max(...dates),
  });
}

const session: GatherSession = {
  async probeIdentity() {
    turns += 1;
    if (slowProbe(turns)) mock.timers.tick(60_000);
    return identity;
  },
  pokeFeedPage: async (username) => ok({ endpoint: 'fan_feed_page', payload: { url: `/${username}/feed`, status: 200, bytes: 0 }, fetchedAt: at() }),
  fetchWishlistItems: async () => ok({ pages: 0, seen: 0, complete: true }),
  fetchFollowingBands: async () => ok({ pages: 0, seen: 0, complete: true }),
  fetchBandDetails: async () => ({ kind: 'error', status: 429 }),
  async fetchFeedUpdates(_fanId, olderThan) {
    const answer = await feedPage(olderThan);
    mock.timers.tick(answer.kind === 'ok' ? REQUEST_MS : 60_000);
    return answer;
  },
  fetchReleasePage: async () => ({ kind: 'error', status: 503 }),
};

// The runner reaches only these; the session is the turn's slice of BandcampSession.
const app = (): RunnerDeps => ({
  db,
  session: session as unknown as RunnerDeps['session'],
  setGather: () => undefined,
  invalidate: () => undefined,
  track: (tally) => tallies.push(tally),
});

async function gather(reason: GatherReason = 'open'): Promise<void> {
  let ended = false;
  const run = runner(reason, app()).finally(() => {
    ended = true;
  });
  while (!ended) {
    await new Promise((resolve) => setImmediate(resolve));
    mock.timers.runAll();
  }
  return run;
}

const walk = () => readKv<WalkState>(db, WALK_KEY);
const walkDone = async () => (await readKv<GatherState>(db, GATHER_KEY))?.initialWalkDone === true;

beforeEach(async () => {
  ({ db, close } = await openTestStore());
  mock.timers.enable({ apis: ['Date', 'setTimeout'], now: START });
  mock.method(console, 'log', () => undefined);
  mock.method(console, 'warn', () => undefined);
  foreground.currentState = 'active';
  turns = 0;
  identity = ok(FAN);
  const newest = Math.floor(START / 1000) - 3600;
  feed = Array.from({ length: 80 * PAGE_SIZE }, (_, i) => ({ itemId: 1000 + i, at: newest - 60 * i }));
  feedPage = servedPage;
  slowProbe = () => false;
  tallies = [];
});

afterEach(() => {
  mock.reset();
  mock.timers.reset();
});

test('a first walk longer than a dozen turns runs to its end in one sitting while the app is open', async () => {
  await gather();
  assert.ok(turns > 12, `took ${turns} turns`);
  assert.equal(await walkDone(), true);
  assert.equal(await walk(), null);
});

test('the chain stops when the app leaves the foreground, with the walk held for the next wake', async () => {
  feedPage = (olderThan) => {
    if (turns === 3) foreground.currentState = 'background';
    return servedPage(olderThan);
  };
  await gather();
  assert.equal(turns, 3);
  assert.equal(await walkDone(), false);
  assert.ok(((await walk())?.pagesDone ?? 0) > 0);
});

test('turns that leave the walk where it was end the chain, and a turn that moves it starts the count again', async () => {
  slowProbe = (turn) => {
    // Past twenty turns the Fan answers signed out, so a chain the guard failed to end stops here instead of spinning.
    if (turn > 20) identity = { kind: 'logged_out' };
    return turn !== 1 && turn !== 4;
  };
  await gather();
  assert.equal(turns, 4 + STALL_TURNS);
  assert.equal(await walkDone(), false);
});

test('a failed turn uses a retry only until a turn moves the walk again', async () => {
  let asked = 0;
  feedPage = (olderThan) => ((asked += 1) % 15 === 0 ? { kind: 'unreachable' } : servedPage(olderThan));
  await gather();
  assert.ok(asked > 15 * (1 + FAILED_RETRIES), `asked ${asked} pages`);
  assert.equal(await walkDone(), true);
});

test('a sign-out from Settings mid-chain ends the chain before the next probe answers for it', async () => {
  feedPage = async (olderThan) => {
    if (turns === 2 && identity.kind === 'ok') {
      identity = { kind: 'logged_out' };
      await patchGather(app(), { pausedReason: 'not_connected' });
    }
    return servedPage(olderThan);
  };
  await gather();
  assert.equal(turns, 2);
  assert.equal((await readKv<GatherState>(db, GATHER_KEY))?.pausedReason, 'not_connected');
});

test('a store holding the Demo runs no turn, so no probe can call it signed out', async () => {
  await loadDemo(db, START);
  identity = { kind: 'logged_out' };
  await gather();
  assert.equal(turns, 0);
  assert.equal((await readKv<GatherState>(db, GATHER_KEY))?.pausedReason, null);
});

test('a store closed under the chain ends it without a rejection', async () => {
  feedPage = (olderThan) => {
    if (turns === 2) close();
    return servedPage(olderThan);
  };
  await gather();
  assert.equal(turns, 2);
});

const names = () => tallies.map((tally) => tally.name);
const finished = () => tallies.find((tally) => tally.name === 'gather_finished')?.props;

test('the chain that ends the first walk sends one sync_run_finished and one gather_finished, and the next chain no Sync Run', async () => {
  await gather();
  assert.deepEqual(names(), ['sync_run_finished', 'gather_finished']);
  assert.deepEqual(tallies[0]?.props, { pages: '21 to 100', stories: '100+', took: '10m+' });
  assert.deepEqual(finished(), {
    reason: 'open',
    outcome: 'done',
    turns: '6 to 20',
    retries: '0',
    walk_pending: false,
    failure: 'none',
    paused: 'none',
    status_class: 'none',
    took: '10m+',
    release_pages_failed: '0',
    sweep_breaker_opened: false,
    failed_step: 'none',
    status_code: 'none',
    feed_retried: false,
  });
  tallies = [];
  await gather('refresh');
  assert.deepEqual(names(), ['gather_finished']);
  assert.equal(finished()?.reason, 'refresh');
});

test('a chain the background ends sends gather_finished alone, with the walk still pending', async () => {
  feedPage = (olderThan) => {
    if (turns === 3) foreground.currentState = 'background';
    return servedPage(olderThan);
  };
  await gather();
  assert.deepEqual(names(), ['gather_finished']);
  assert.equal(finished()?.outcome, 'out_of_budget');
  assert.equal(finished()?.walk_pending, true);
  assert.equal(finished()?.turns, '2 to 5');
});

test('the retries a chain spends on unanswered turns are counted across the whole chain', async () => {
  let asked = 0;
  feedPage = (olderThan) => ((asked += 1) % 15 === 0 ? { kind: 'unreachable' } : servedPage(olderThan));
  await gather();
  assert.deepEqual(names(), ['sync_run_finished', 'gather_finished']);
  // Past FAILED_RETRIES, since each turn that moves the walk gives the retries back.
  assert.equal(finished()?.retries, '6 to 20');
});

test('a chain Bandcamp ends with a status carries the failure and its class, and a signed-out chain sends nothing', async () => {
  feedPage = () => ({ kind: 'error', status: 503 });
  await gather();
  assert.deepEqual(names(), ['gather_finished']);
  assert.equal(finished()?.outcome, 'failed');
  assert.equal(finished()?.failure, 'bandcamp_error');
  assert.equal(finished()?.status_class, '5xx');
  tallies = [];
  await patchGather(app(), { pausedReason: 'not_connected' });
  await gather();
  assert.deepEqual(names(), []);
});

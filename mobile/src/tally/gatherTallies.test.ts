/// <reference types="node" />
/**
 * The gather diff (task 0038) over real gather turns: the phone's own sink and store on `node:sqlite`, a Bandcamp
 * that serves a purchase feed five Stories a page, and a clock that moves a second per request.
 */
import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';
import type { SQLiteDatabase } from 'expo-sqlite';

import { FAN_ID, feedPayload, purchaseAt } from '../../test/fixtures';
import { openTestStore } from '../../test/nodeDb';
import type { FeedUpdatesPage } from '../bandcamp/session';
import type { BandcampAnswer, Identity } from '../bandcamp/wire';
import { EMPTY_GATHER_STATE, type GatherSink } from '../fetcher/sink';
import { runGatherTurn, type GatherReason, type GatherSession } from '../fetcher/turn';
import { createGatherSink } from '../state/gatherSink';
import type { Tally } from './catalogue';
import { gatherTallies } from './tally';

const START = Date.UTC(2026, 8, 29, 12, 0, 0);
const PAGE_SIZE = 5;
const FAN: Identity = { fanId: FAN_ID, username: 'diggerfan' };

let db: SQLiteDatabase;
let sink: GatherSink;
let clock: number;
let feedAt: number[];
let pagesAsked: number;
let probe: BandcampAnswer<Identity>;

const ok = <T>(value: T): BandcampAnswer<T> => ({ kind: 'ok', value });
const iso = (): string => new Date(clock).toISOString();

const session: GatherSession = {
  probeIdentity: async () => probe,
  pokeFeedPage: async (username) => ok({ endpoint: 'fan_feed_page', payload: { url: `/${username}/feed`, status: 200, bytes: 0 }, fetchedAt: iso() }),
  fetchWishlistItems: async () => ok({ pages: 0, seen: 0, complete: true }),
  fetchFollowingBands: async () => ok({ pages: 0, seen: 0, complete: true }),
  fetchBandDetails: async () => ({ kind: 'error', status: 429 }),
  fetchReleasePage: async () => ({ kind: 'error', status: 404 }),
  async fetchFeedUpdates(_fanId, olderThan): Promise<BandcampAnswer<FeedUpdatesPage>> {
    clock += 1_000;
    pagesAsked += 1;
    const page = feedAt.filter((at) => at < olderThan).slice(0, PAGE_SIZE);
    return ok({
      document: {
        endpoint: 'fan_dash_feed_updates',
        payload: feedPayload({ entries: page.map((at) => purchaseAt(1000 + feedAt.indexOf(at), at)) }),
        fetchedAt: iso(),
      },
      entryCount: page.length,
      oldestStoryDate: page.length === 0 ? null : Math.min(...page),
      newestStoryDate: page.length === 0 ? null : Math.max(...page),
    });
  },
};

/** One chain of a single turn, measured the way `runChain` will: state and walk before, state after. */
async function chain(budgetMs: number, reason: GatherReason = 'open'): Promise<Tally[]> {
  const before = await sink.readGatherState();
  const walkAtStart = await sink.readWalk();
  const startedAt = clock;
  const last = await runGatherTurn(session, sink, { now: () => clock, reason, budgetMs });
  const after = await sink.readGatherState();
  const feedPages = (await db.getFirstAsync<{ n: number }>(
    "select count(*) as n from raw_documents where endpoint = 'fan_dash_feed_updates'",
  ))?.n ?? 0;
  return gatherTallies(before, after, {
    reason, last, turns: 1, retries: 0, startedAt, endedAt: clock, walkAtStart, feedPages,
    releasePagesFailed: 0, sweepBreakerOpened: false,
  });
}

beforeEach(async () => {
  ({ db } = await openTestStore());
  sink = createGatherSink({ db, setGather: () => undefined, invalidate: () => undefined });
  clock = START;
  const newest = Math.floor(START / 1000) - 3600;
  feedAt = Array.from({ length: 23 }, (_, i) => newest - 60 * i);
  pagesAsked = 0;
  probe = ok(FAN);
});

describe('the gather diff', () => {
  test('the chain that finishes the first walk sends one sync_run_finished, and later chains none', async () => {
    const first = await chain(600_000);
    assert.equal(pagesAsked, 14, "the depth probe's eight (task 0040), five full pages and the empty one that ends the walk");
    assert.deepEqual(first, [
      { name: 'sync_run_finished', props: { pages: '6 to 20', stories: '21 to 100', took: '10 to 60s' } },
      {
        name: 'gather_finished',
        props: {
          reason: 'open', outcome: 'done', turns: '1', retries: '0', walk_pending: false, failure: 'none', paused: 'none',
          status_class: 'none', took: '10 to 60s', release_pages_failed: '0', sweep_breaker_opened: false,
          failed_step: 'none', status_code: 'none', feed_retried: false,
        },
      },
    ]);
    clock += 15 * 60_000;
    assert.deepEqual((await chain(600_000, 'timer')).map((t) => t.name), ['gather_finished']);
  });

  test('a first walk resumed after twenty minutes counts its time from the walk start, not the chain start', async () => {
    const cut = await chain(3_500);
    assert.deepEqual(cut.map((t) => t.name), ['gather_finished']);
    assert.equal(cut[0]?.name === 'gather_finished' && cut[0].props.walk_pending, true);
    clock += 20 * 60_000;
    pagesAsked = 0;
    const [sync, gather] = await chain(600_000);
    // The cut came mid-probe (task 0040): the probe searches on between its kept bounds, then the walk's two pages.
    assert.equal(pagesAsked, 10);
    assert.equal(sync?.name === 'sync_run_finished' && sync.props.took, '10m+');
    assert.equal(gather?.name === 'gather_finished' && gather.props.took, '10 to 60s');
  });

  test('an unreachable Bandcamp ends the chain failed with its code, and no Sync Run', async () => {
    probe = { kind: 'unreachable' };
    const [only, ...rest] = await chain(600_000);
    assert.deepEqual(rest, []);
    assert.equal(only?.name, 'gather_finished');
    if (only?.name !== 'gather_finished') return;
    assert.deepEqual(
      [only.props.outcome, only.props.failure, only.props.paused, only.props.status_class, only.props.failed_step],
      ['failed', 'bandcamp_unreachable', 'none', 'none', 'probe'],
    );
  });

  test('a signed-out probe pauses the chain: logged_out once a Fan was held, not_connected before', async () => {
    probe = { kind: 'logged_out' };
    const [fresh] = await chain(600_000);
    assert.equal(fresh?.name === 'gather_finished' && fresh.props.paused, 'not_connected');
    probe = ok(FAN);
    await chain(600_000);
    probe = { kind: 'logged_out' };
    const [held] = await chain(600_000);
    assert.equal(held?.name === 'gather_finished' && held.props.paused, 'logged_out');
    assert.equal(held?.name === 'gather_finished' && held.props.outcome, 'paused');
  });

  test('a chain paused at the probe does not repeat the failure an earlier chain left standing', async () => {
    await chain(600_000);
    probe = { kind: 'unreachable' };
    const [offline] = await chain(600_000);
    assert.equal(offline?.name === 'gather_finished' && offline.props.failure, 'bandcamp_unreachable');
    probe = { kind: 'logged_out' };
    for (let i = 0; i < 2; i += 1) {
      const [paused] = await chain(600_000, 'timer');
      assert.deepEqual(
        paused?.name === 'gather_finished' && [paused.props.outcome, paused.props.failure, paused.props.paused],
        ['paused', 'none', 'logged_out'],
      );
    }
  });
});

test('a failure with an HTTP status carries its class, and no failure carries none', () => {
  const chainFacts = {
    reason: 'open',
    last: { reason: 'open', outcome: 'failed', walkPending: true, status: 0, failedStep: 'feed_page', feedRetried: true },
    turns: 1,
    retries: 2,
    startedAt: 0, endedAt: 1, walkAtStart: null, feedPages: 0, releasePagesFailed: 0, sweepBreakerOpened: false,
  } as const;
  const propsOf = (lastError: 'bandcamp_error' | null, lastStatus: number | null) => {
    const [tally] = gatherTallies(EMPTY_GATHER_STATE, { ...EMPTY_GATHER_STATE, lastError, lastStatus }, chainFacts);
    return tally?.name === 'gather_finished' ? tally.props : null;
  };
  const classOf = (lastError: 'bandcamp_error' | null, lastStatus: number | null) => propsOf(lastError, lastStatus)?.status_class;
  assert.deepEqual(
    [classOf('bandcamp_error', 429), classOf('bandcamp_error', 503), classOf('bandcamp_error', null), classOf(null, 429)],
    ['4xx', '5xx', 'none', 'none'],
  );
  const codeOf = (lastStatus: number | null) => propsOf('bandcamp_error', lastStatus)?.status_code;
  assert.deepEqual(
    [codeOf(200), codeOf(400), codeOf(403), codeOf(418), codeOf(503), codeOf(0), codeOf(null), propsOf(null, 400)?.status_code],
    ['2xx', '400', '403', 'other_4xx', '5xx', 'none', 'none', 'none'],
  );
  assert.deepEqual([propsOf(null, null)?.failed_step, propsOf(null, null)?.feed_retried], ['feed_page', true]);
});

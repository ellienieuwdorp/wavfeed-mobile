/// <reference types="node" />
/**
 * Gather turns through the phone's own sink and store (task 0036, decision 4), against a Bandcamp that serves a list
 * of purchase Stories newest first behind the feed's `older_than` cursor. Each request costs the clock a second.
 */
import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';
import type { SQLiteDatabase } from 'expo-sqlite';

import { FAN_ID, feedPayload, purchaseAt, releasePagePayload } from '../../test/fixtures';
import { openTestStore } from '../../test/nodeDb';
import type { BandcampAnswer, Identity } from '../bandcamp/wire';
import type { BandDetails, FeedUpdatesPage, ReleasePage } from '../bandcamp/session';
import { createGatherSink, WALK_KEY } from '../state/gatherSink';
import { readUndatedReleases } from '../store/enrichment';
import { writeKv } from '../store/kv';
import { fold } from '../store/projection';
import { insertRawDocument } from '../store/rawDocuments';
import { EMPTY_GATHER_STATE, type GatherSink, type GatherState } from './sink';
import { DEPTH_PROBE_RESOLUTION_S, type GatherReason, type GatherSession, POLL_MAX_PAGES, runGatherTurn } from './turn';

const START = Date.UTC(2026, 8, 25, 12, 0, 0);
const PAGE_SIZE = 5;
const REQUEST_MS = 1_000;
const FAN: Identity = { fanId: FAN_ID, username: 'diggerfan' };
const OTHER_FAN: Identity = { fanId: FAN_ID + 1, username: 'mara.dj' };
const START_S = Math.floor(START / 1000);
const DAY_S = 86_400;

type Story = { readonly itemId: number; readonly at: number };

/** `count` Stories `stepS` apart, the newest `newestAgoS` seconds before START; item ids from `firstId` up. */
function stories(count: number, firstId: number, newestAgoS = 3600, stepS = 60): Story[] {
  const newest = START_S - newestAgoS;
  return Array.from({ length: count }, (_, i) => ({ itemId: firstId + i, at: newest - stepS * i }));
}

/** `count` Stories a day apart, the newest on the given UTC day. */
function daily(count: number, firstId: number, year: number, month: number, day: number): Story[] {
  return stories(count, firstId, START_S - Date.UTC(year, month, day) / 1000, DAY_S);
}

let db: SQLiteDatabase;
let sink: GatherSink;
let gather: GatherState;
let clock: number;
let feed: Story[];
/** Bandcamp answers any cursor older than this as if it were this: the same window again. */
let replayFloor: number | null;
let cursors: number[];
let releasePages: number[];
let bandDetailsAsked: number[];
let bandDetails: BandcampAnswer<BandDetails>;
let probe: BandcampAnswer<Identity>;
/** A refusal for the feed request with this index in `cursors`, or null to answer it. */
let refuseFeed: (asked: number) => BandcampAnswer<never> | null;
let releasePage: (itemId: number) => BandcampAnswer<ReleasePage>;

const ok = <T>(value: T): BandcampAnswer<T> => ({ kind: 'ok', value });
const at = (): string => new Date(clock).toISOString();

const session: GatherSession = {
  probeIdentity: async () => probe,
  pokeFeedPage: async (username) => ok({ endpoint: 'fan_feed_page', payload: { url: `/${username}/feed`, status: 200, bytes: 0 }, fetchedAt: at() }),
  fetchWishlistItems: async () => ok({ pages: 0, seen: 0, complete: true }),
  fetchFollowingBands: async () => ok({ pages: 0, seen: 0, complete: true }),
  async fetchBandDetails(bandId) {
    clock += REQUEST_MS;
    bandDetailsAsked.push(bandId);
    return bandDetails;
  },
  async fetchFeedUpdates(_fanId, olderThan): Promise<BandcampAnswer<FeedUpdatesPage>> {
    clock += REQUEST_MS;
    cursors.push(olderThan);
    const refusal = refuseFeed(cursors.length - 1);
    if (refusal !== null) return refusal;
    const cursor = replayFloor === null ? olderThan : Math.max(olderThan, replayFloor);
    const page = feed.filter((story) => story.at < cursor).sort((a, b) => b.at - a.at).slice(0, PAGE_SIZE);
    const dates = page.map((story) => story.at);
    return ok({
      document: { endpoint: 'fan_dash_feed_updates', payload: feedPayload({ entries: page.map((story) => purchaseAt(story.itemId, story.at)) }), fetchedAt: at() },
      entryCount: page.length,
      oldestStoryDate: page.length === 0 ? null : Math.min(...dates),
      newestStoryDate: page.length === 0 ? null : Math.max(...dates),
    });
  },
  async fetchReleasePage(_url, key) {
    clock += REQUEST_MS;
    releasePages.push(key.itemId);
    return releasePage(key.itemId);
  },
};

function datedPage(itemId: number): BandcampAnswer<ReleasePage> {
  return ok({ kind: 'page', document: { endpoint: 'release_page', payload: releasePagePayload({ itemId }), fetchedAt: at() } });
}

function turn(budgetMs = 600_000, reason: GatherReason = 'open') {
  return runGatherTurn(session, sink, { now: () => clock, reason, budgetMs });
}

async function followBands(bandIds: readonly number[]): Promise<void> {
  const follows = Object.fromEntries(bandIds.map((bandId) => [String(bandId), { band_id: bandId }]));
  const followingBands = { item_cache: { following_bands: follows }, following_bands: { item_count: bandIds.length } };
  await insertRawDocument(db, { endpoint: 'following_bands', payload: { fanId: FAN.fanId, page: 1, snapshotStartedAt: at(), followingBands }, fetchedAt: at() });
  await fold(db);
}

async function storyCount(): Promise<number> {
  return (await db.getFirstAsync<{ n: number }>('select count(*) as n from stories'))?.n ?? 0;
}

beforeEach(async () => {
  ({ db } = await openTestStore());
  gather = EMPTY_GATHER_STATE;
  sink = createGatherSink({ db, setGather: (state) => (gather = state), invalidate: () => undefined });
  clock = START;
  feed = [];
  replayFloor = null;
  cursors = [];
  releasePages = [];
  bandDetailsAsked = [];
  bandDetails = { kind: 'error', status: 429 };
  probe = ok(FAN);
  refuseFeed = () => null;
  releasePage = datedPage;
});

describe('the feed walk', () => {
  test('a first walk takes the whole feed, and a poll after it stops at what the walk reached', async () => {
    feed = stories(23, 1000);
    assert.deepEqual(await turn(), { reason: 'open', outcome: 'done', walkPending: false, status: null });
    assert.equal(await storyCount(), 23);
    assert.equal(gather.newestStoryDate, feed[0]?.at);

    clock += 15 * 60_000;
    feed = [...stories(2, 2000, 60), ...feed];
    cursors = [];
    assert.equal((await turn(600_000, 'timer')).outcome, 'done');
    assert.equal(cursors.length, 1, 'the first page already reaches held Stories, and a poll asks no depth probe');
    assert.equal(await storyCount(), 25);
  });

  test('a poll that reaches its page cap before what it holds keeps walking (audit B1)', async () => {
    feed = stories(3, 1000, 86_400);
    await turn();
    const newer = POLL_MAX_PAGES * PAGE_SIZE + 7;
    feed = [...stories(newer, 5000, 60), ...feed];
    assert.equal((await turn(600_000, 'timer')).outcome, 'done');
    assert.equal(await storyCount(), 3 + newer);
  });

  test('a window Bandcamp serves again ends the walk instead of running to the cap', async () => {
    feed = stories(40, 1000);
    replayFloor = feed[PAGE_SIZE - 1]?.at ?? null;
    assert.equal((await turn()).outcome, 'done');
    assert.ok(cursors.length < 5, `asked ${cursors.length} pages`);
  });

  test('a turn out of budget resumes at its cursor', async () => {
    feed = stories(40, 1000);
    assert.deepEqual(await turn(3_500), { reason: 'open', outcome: 'out_of_budget', walkPending: true, status: null });
    assert.equal((await turn()).outcome, 'done');
    assert.equal(new Set(cursors).size, cursors.length, 'no page asked twice');
    assert.equal(await storyCount(), 40);
  });

  test('a walk holds time back for the release pages it has queued (ADR-0011)', async () => {
    feed = stories(200, 1000);
    await turn(12_000);
    assert.equal(gather.releasesDated, 0);
    releasePages = [];
    assert.deepEqual(await turn(12_000), { reason: 'open', outcome: 'out_of_budget', walkPending: true, status: null });
    assert.equal(releasePages.length, 5);
    assert.equal(gather.releasesDated, 5);
  });

  test('the last success moves once the feed is in, before the release pages after it', async () => {
    feed = stories(3, 1000, 86_400);
    await turn();
    const before = gather.lastSuccessAt;
    assert.notEqual(before, null);

    clock += 15 * 60_000;
    feed = [...stories(2, 2000, 60), ...feed];
    const seen: Pick<GatherState, 'phase' | 'lastSuccessAt'>[] = [];
    sink = createGatherSink({
      db,
      setGather: (state) => {
        gather = state;
        seen.push({ phase: state.phase, lastSuccessAt: state.lastSuccessAt });
      },
      invalidate: () => undefined,
    });
    await turn(600_000, 'refresh');
    assert.ok(releasePages.length > 0, 'the new Stories send the turn on to release pages');
    const dating = seen.findIndex((state) => state.phase === 'dating');
    assert.ok(dating > 0);
    const moved = seen.findIndex((state) => state.lastSuccessAt !== before);
    assert.equal(moved, dating - 1, 'it moves once the feed ends, not on an answer and not at the turn end');
    assert.ok((seen[moved]?.lastSuccessAt ?? 0) > (before ?? 0));
  });
});

describe('the depth probe (task 0040)', () => {
  test('a first walk finds the oldest Story first, and every Story counts once, when the walk reaches it', async () => {
    feed = [...stories(40, 1000), ...daily(12, 2000, 2014, 2, 10)];
    const oldest = Math.min(...feed.map((story) => story.at));
    assert.equal((await turn(10_000)).outcome, 'out_of_budget');

    const held = await sink.readWalk();
    assert.ok(held?.probed && held.floor !== null);
    assert.ok(held.floor >= oldest && held.floor - oldest <= DEPTH_PROBE_RESOLUTION_S, `floor ${held.floor}`);
    assert.equal(gather.storiesSoFar, held.pagesDone * PAGE_SIZE, 'only the walk counts');
    assert.ok((await storyCount()) > gather.storiesSoFar, "the probe's answers are folded");

    cursors = [];
    assert.equal((await turn()).outcome, 'done');
    assert.equal(cursors[0], held.olderThan, 'a resumed walk goes on from its cursor without probing again');
    assert.equal(gather.storiesSoFar, feed.length);
    assert.equal(await storyCount(), feed.length);
  });

  test('pages identical to what the probe landed do not end a first walk as already held', async () => {
    // The probe lands the 2016 and the 2011 runs, then finds nothing older than 2010-12-10; the walk meets both runs
    // again, byte for byte, before the 2010 run it never saw.
    feed = [...stories(5, 1000), ...daily(5, 2000, 2016, 5, 1), ...daily(5, 3000, 2011, 0, 1), ...daily(5, 4000, 2010, 11, 20)];
    assert.equal((await turn()).outcome, 'done');
    assert.equal(await storyCount(), feed.length);
    assert.equal(gather.storiesSoFar, feed.length);
  });

  test('a probe the budget cuts short searches on in the next turn, down to the oldest Story', async () => {
    // Four years of Stories four days apart, far below the first answer's oldest.
    feed = [...stories(40, 1000), ...stories(360, 2000, START_S - Date.UTC(2014, 2, 10) / 1000, 4 * DAY_S)];
    const oldest = Math.min(...feed.map((story) => story.at));
    assert.equal((await turn(2_500)).outcome, 'out_of_budget');
    assert.equal((await sink.readWalk())?.probed, false);

    assert.equal((await turn(20_000)).outcome, 'out_of_budget');
    const held = await sink.readWalk();
    assert.ok(held?.probed && held.floor !== null);
    assert.ok(held.floor >= oldest && held.floor - oldest <= DEPTH_PROBE_RESOLUTION_S, `floor ${held.floor}`);
  });

  test('a turn killed between counting a page the probe landed and moving the cursor counts it once', async () => {
    feed = [...stories(5, 1000), ...daily(5, 2000, 2016, 5, 1), ...daily(5, 3000, 2011, 0, 1), ...daily(5, 4000, 2010, 11, 20)];
    const store = sink;
    let walking = false;
    let armed = false;
    let killed = false;
    // The app dies at the first walk write after the walk, past its probe, meets a page the probe already landed.
    sink = {
      ...store,
      async putRaw(doc) {
        const put = await store.putRaw(doc);
        armed ||= walking && put.deduped && doc.endpoint === 'fan_dash_feed_updates';
        return put;
      },
      async writeWalk(walk) {
        if (armed && !killed) {
          killed = true;
          throw new Error('killed');
        }
        await store.writeWalk(walk);
        walking ||= walk?.probed === true;
      },
    };
    assert.equal((await turn()).outcome, 'failed');
    assert.ok(killed);
    assert.equal((await turn()).outcome, 'done');
    assert.equal(gather.storiesSoFar, feed.length);
  });

  test('a signed-out answer mid-probe pauses the turn, and the next turn probes again', async () => {
    feed = stories(40, 1000);
    refuseFeed = (asked) => (asked === 1 ? { kind: 'logged_out' } : null);
    assert.equal((await turn()).outcome, 'paused');
    assert.equal(gather.pausedReason, 'logged_out');
    const held = await sink.readWalk();
    assert.equal(held?.probed, false);

    refuseFeed = () => null;
    cursors = [];
    assert.equal((await turn()).outcome, 'done');
    assert.ok((cursors[0] ?? Infinity) < held.olderThan, 'the first request is a probe below the cursor');
    assert.equal(await storyCount(), 40);
  });

  test('a Bandcamp error mid-probe fails the turn with its status, and the next turn searches on', async () => {
    feed = stories(40, 1000);
    refuseFeed = (asked) => (asked === 1 ? { kind: 'error', status: 429 } : null);
    const failed = await turn();
    assert.equal(failed.outcome, 'failed');
    assert.equal(failed.status, 429);
    assert.equal(cursors.length, 2, 'nothing is asked after the refusal');
    const held = await sink.readWalk();
    assert.equal(held?.probed, false);
    assert.equal(held.pagesDone, 0);

    refuseFeed = () => null;
    assert.equal((await turn()).outcome, 'done');
    assert.equal(await storyCount(), 40);
  });

  test('a probe answer that does not arrive ends the probe and the walk still runs', async () => {
    feed = stories(40, 1000);
    refuseFeed = (asked) => (asked === 0 ? { kind: 'unreachable' } : null);
    assert.equal((await turn()).outcome, 'done');
    assert.equal(cursors[1], START_S, "the walk's first page follows the failed probe");
    assert.equal(await storyCount(), 40);
  });

  test('a poll stored before the probe existed resumes, through a page already held', async () => {
    feed = stories(20, 1000);
    await turn();
    // The shape a walk had before task 0040, at the cursor the first walk's first page was asked with.
    const poll = { kind: 'feed_poll', fanId: FAN.fanId, username: FAN.username, olderThan: START_S, pagesDone: 0, dedupedRun: 0, maxPages: POLL_MAX_PAGES, poked: true, startedAt: START, sinceTs: gather.newestStoryDate, newestSeen: null };
    await writeKv(db, WALK_KEY, poll);
    cursors = [];
    assert.equal((await turn(600_000, 'timer')).outcome, 'done');
    assert.deepEqual(cursors, [START_S]);
    assert.equal(await sink.readWalk(), null);
  });
});

describe('the probe', () => {
  test('a signed-out probe pauses as not connected before any Fan, and as logged out after one', async () => {
    probe = { kind: 'logged_out' };
    assert.equal((await turn()).outcome, 'paused');
    assert.equal(gather.pausedReason, 'not_connected');
    probe = ok(FAN);
    await turn();
    probe = { kind: 'logged_out' };
    assert.equal((await turn()).outcome, 'paused');
    assert.equal(gather.pausedReason, 'logged_out');
    assert.equal(gather.identity?.fanId, FAN.fanId);
  });

  test('a different Fan signed in pauses the store as signed out and files other_fan, not a store error', async () => {
    await turn();
    probe = ok(OTHER_FAN);
    assert.equal((await turn()).outcome, 'paused');
    assert.equal(gather.pausedReason, 'logged_out');
    assert.equal(gather.lastError, 'other_fan');
    assert.equal(gather.identity?.fanId, FAN.fanId);
    assert.equal(gather.phase, 'idle');
  });

  test('a 429 on the probe is a Bandcamp error with its status, not a sign-out', async () => {
    await turn();
    probe = { kind: 'error', status: 429 };
    assert.deepEqual(await turn(), { reason: 'open', outcome: 'failed', walkPending: false, status: 429 });
    assert.equal(gather.pausedReason, null);
    assert.equal(gather.lastError, 'bandcamp_error');
    assert.equal(gather.lastStatus, 429);
  });
});

describe('a feed page Bandcamp fails', () => {
  test('fails the turn with its status, and keeps the status beside the failure until a probe answers again', async () => {
    feed = stories(3, 1000);
    refuseFeed = () => ({ kind: 'error', status: 503 });
    assert.deepEqual(await turn(), { reason: 'open', outcome: 'failed', walkPending: true, status: 503 });
    assert.equal(gather.lastError, 'bandcamp_error');
    assert.equal(gather.lastStatus, 503);

    refuseFeed = () => null;
    assert.equal((await turn(600_000, 'timer')).outcome, 'done');
    assert.equal(gather.lastError, null);
    assert.equal(gather.lastStatus, null);
  });

  test('with a 429 asks for no release page or band details after it (ADR-0017)', async () => {
    feed = stories(3, 1000);
    releasePage = () => ({ kind: 'error', status: 503 });
    await turn();
    await followBands([1, 2]);
    bandDetails = ok({ kind: 'gone', status: 404 });
    releasePage = datedPage;
    releasePages = [];

    clock += 15 * 60_000;
    refuseFeed = () => ({ kind: 'error', status: 429 });
    const summary = await turn(600_000, 'timer');
    assert.equal(summary.outcome, 'failed');
    assert.equal(summary.status, 429);
    assert.deepEqual(releasePages, []);
    assert.deepEqual(bandDetailsAsked, []);

    clock += 15 * 60_000;
    refuseFeed = () => null;
    assert.equal((await turn(600_000, 'timer')).outcome, 'done');
    assert.equal(releasePages.length, 3);
    assert.deepEqual(bandDetailsAsked, [1, 2]);
  });

  test('unanswered fails the turn with no status', async () => {
    refuseFeed = () => ({ kind: 'unreachable' });
    assert.deepEqual(await turn(), { reason: 'open', outcome: 'failed', walkPending: true, status: null });
    assert.equal(gather.lastError, 'bandcamp_unreachable');
  });
});

describe('release pages', () => {
  test("only a page's own refusal counts against it, and any failure ends the pass", async () => {
    feed = stories(3, 1000);
    releasePage = () => ({ kind: 'error', status: 503 });
    await turn();
    assert.equal(releasePages.length, 1);
    assert.equal((await readUndatedReleases(db, 10, new Date(clock))).length, 3);

    releasePage = () => ({ kind: 'error', status: 400 });
    await turn(600_000, 'timer');
    assert.equal(releasePages.length, 2);
    assert.deepEqual((await readUndatedReleases(db, 10, new Date(clock))).map((release) => release.itemId), [1001, 1002]);
  });
});

describe('the band details sweep', () => {
  test('a 429 stops sweeping until the breaker cools down (ADR-0017)', async () => {
    await followBands([1, 2, 3, 4]);

    await turn();
    assert.deepEqual(bandDetailsAsked, [1]);
    assert.equal(gather.lastError, 'bandcamp_error');
    clock += 60_000;
    await turn();
    assert.deepEqual(bandDetailsAsked, [1], 'still cooling down a minute on');
  });
});

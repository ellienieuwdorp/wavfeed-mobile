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
import type { FeedUpdatesPage, ReleasePage } from '../bandcamp/session';
import { createGatherSink } from '../state/gatherSink';
import { readUndatedReleases } from '../store/enrichment';
import { fold } from '../store/projection';
import { insertRawDocument } from '../store/rawDocuments';
import { EMPTY_GATHER_STATE, type GatherSink, type GatherState } from './sink';
import { type GatherReason, type GatherSession, POLL_MAX_PAGES, runGatherTurn } from './turn';

const START = Date.UTC(2026, 8, 25, 12, 0, 0);
const PAGE_SIZE = 5;
const REQUEST_MS = 1_000;
const FAN: Identity = { fanId: FAN_ID, username: 'diggerfan' };

type Story = { readonly itemId: number; readonly at: number };

/** `count` Stories a minute apart, the newest `newestAgoS` seconds before START; item ids from `firstId` up. */
function stories(count: number, firstId: number, newestAgoS = 3600): Story[] {
  const newest = Math.floor(START / 1000) - newestAgoS;
  return Array.from({ length: count }, (_, i) => ({ itemId: firstId + i, at: newest - 60 * i }));
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
let probe: BandcampAnswer<Identity>;
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
    return { kind: 'error', status: 429 };
  },
  async fetchFeedUpdates(_fanId, olderThan): Promise<BandcampAnswer<FeedUpdatesPage>> {
    clock += REQUEST_MS;
    cursors.push(olderThan);
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
  probe = ok(FAN);
  releasePage = datedPage;
});

describe('the feed walk', () => {
  test('a first walk takes the whole feed, and a poll after it stops at what the walk reached', async () => {
    feed = stories(23, 1000);
    assert.deepEqual(await turn(), { reason: 'open', outcome: 'done', walkPending: false });
    assert.equal(await storyCount(), 23);
    assert.equal(gather.newestStoryDate, feed[0]?.at);

    clock += 15 * 60_000;
    feed = [...stories(2, 2000, 60), ...feed];
    cursors = [];
    assert.equal((await turn(600_000, 'timer')).outcome, 'done');
    assert.equal(cursors.length, 1, 'the first page already reaches held Stories');
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
    assert.deepEqual(await turn(3_500), { reason: 'open', outcome: 'out_of_budget', walkPending: true });
    assert.equal((await turn()).outcome, 'done');
    assert.equal(new Set(cursors).size, cursors.length, 'no page asked twice');
    assert.equal(await storyCount(), 40);
  });

  test('a walk holds time back for the release pages it has queued (ADR-0011)', async () => {
    feed = stories(200, 1000);
    await turn(12_000);
    assert.equal(gather.releasesDated, 0);
    releasePages = [];
    assert.deepEqual(await turn(12_000), { reason: 'open', outcome: 'out_of_budget', walkPending: true });
    assert.equal(releasePages.length, 5);
    assert.equal(gather.releasesDated, 5);
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
    const follows = Object.fromEntries([1, 2, 3, 4].map((bandId) => [String(bandId), { band_id: bandId }]));
    const payload = { fanId: FAN.fanId, page: 1, snapshotStartedAt: at(), followingBands: { item_cache: { following_bands: follows }, following_bands: { item_count: 4 } } };
    await insertRawDocument(db, { endpoint: 'following_bands', payload, fetchedAt: at() });
    await fold(db);

    await turn();
    assert.deepEqual(bandDetailsAsked, [1]);
    assert.equal(gather.lastError, 'bandcamp_error');
    clock += 60_000;
    await turn();
    assert.deepEqual(bandDetailsAsked, [1], 'still cooling down a minute on');
  });
});

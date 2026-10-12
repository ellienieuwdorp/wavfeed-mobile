/// <reference types="node" />
/**
 * Gather turns through the phone's own sink and store (task 0036, decision 4), against a Bandcamp that serves a list
 * of purchase Stories newest first behind the feed's `older_than` cursor, and release and Track pages by key. Each
 * request costs the clock a second.
 */
import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';
import type { SQLiteDatabase } from 'expo-sqlite';

import {
  BAND_ID,
  bandDetailsPayload,
  discographyItem,
  FAN_ID,
  feedPayload,
  followingBandsFirstPage,
  PREORDER_ITEM_ID,
  PREORDER_URL,
  preorderNrEntry,
  preorderTrackPurchase,
  preorderTrackId,
  preorderTrackPageBlob,
  preorderTralbumBlob,
  purchaseAt,
  releasePagePayload,
} from '../../test/fixtures';
import { openTestStore } from '../../test/nodeDb';
import type { BandcampAnswer, Identity } from '../bandcamp/wire';
import type { BandDetails, FeedUpdatesPage, ReleasePage } from '../bandcamp/session';
import { createGatherSink, WALK_KEY } from '../state/gatherSink';
import { BACKOFF_MS, markReleasePageAttempt, readUndatedReleases, RETRY_AFTER_MS } from '../store/enrichment';
import { writeKv } from '../store/kv';
import { fold } from '../store/projection';
import { listDrops, listUpcomingReleases } from '../store/queries';
import { insertRawDocument } from '../store/rawDocuments';
import { EMPTY_GATHER_STATE, type GatherSink, type GatherState } from './sink';
import { DEPTH_PROBE_RESOLUTION_S, FEED_RETRY_AFTER_MS, type GatherReason, type GatherSession, LIST_INTERVAL_MS, POLL_MAX_PAGES, RATE_PAGES, runGatherTurn } from './turn';

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
let releasePageUrls: string[];
let bandDetailsAsked: number[];
let bandDetails: BandcampAnswer<BandDetails>;
let probe: BandcampAnswer<Identity>;
let probes: number;
/** A refusal for the feed request with this index in `cursors`, or null to answer it. */
let refuseFeed: (asked: number) => BandcampAnswer<never> | null;
let releasePage: (itemId: number, itemType: 'a' | 't') => BandcampAnswer<ReleasePage>;
/** Followed Pages the follow list answers with, as one stored page; none answers with no page. */
let followed: readonly number[];
let wishlisted: readonly number[];
let listsComplete: boolean;
/** What the poke costs the clock; none unless a test sets it. */
let pokeMs: number;
/** The lists and the feed, each named once per request, in the order the turn asked them. */
let asked: ('wishlist' | 'follows' | 'feed')[];

const ok = <T>(value: T): BandcampAnswer<T> => ({ kind: 'ok', value });
const at = (): string => new Date(clock).toISOString();

const session: GatherSession = {
  async probeIdentity() {
    probes += 1;
    return probe;
  },
  async pokeFeedPage(username) {
    clock += pokeMs;
    return ok({ endpoint: 'fan_feed_page', payload: { url: `/${username}/feed`, status: 200, bytes: 0 }, fetchedAt: at() });
  },
  async fetchWishlistItems(_fanId, onDocument) {
    asked.push('wishlist');
    if (wishlisted.length > 0) {
      const inputToken = `${Math.floor(clock / 1000)}::a::`;
      await onDocument({
        endpoint: 'wishlist_items', fetchedAt: at(),
        payload: {
          snapshot_started_at: at(), request: { fan_id: FAN.fanId, older_than_token: inputToken },
          response: { items: wishlisted.map((itemId) => ({ tralbum_type: 'a', tralbum_id: itemId })), more_available: !listsComplete, last_token: 'next' },
          snapshotPage: { number: 1, inputToken, nextToken: listsComplete ? null : 'next' },
        },
      });
    }
    return ok({ pages: wishlisted.length > 0 ? 1 : 0, seen: wishlisted.length, complete: listsComplete });
  },
  async fetchFollowingBands(_fanId, _username, onDocument) {
    asked.push('follows');
    if (followed.length === 0) return ok({ pages: 0, seen: 0, complete: listsComplete });
    clock += REQUEST_MS;
    const payload = followingBandsFirstPage(followed, at());
    if (!listsComplete) {
      payload.followingBands = { ...(payload.followingBands as Record<string, unknown>), following_bands: { item_count: followed.length + 1, last_token: 'next' } };
    }
    await onDocument({ endpoint: 'following_bands', payload, fetchedAt: at() });
    return ok({ pages: 1, seen: followed.length, complete: listsComplete });
  },
  async fetchBandDetails(bandId) {
    clock += REQUEST_MS;
    bandDetailsAsked.push(bandId);
    return bandDetails;
  },
  async fetchFeedUpdates(_fanId, olderThan): Promise<BandcampAnswer<FeedUpdatesPage>> {
    clock += REQUEST_MS;
    asked.push('feed');
    cursors.push(olderThan);
    const refusal = refuseFeed(cursors.length - 1);
    if (refusal !== null) return refusal;
    const cursor = replayFloor === null ? olderThan : Math.max(olderThan, replayFloor);
    const page = feed.filter((story) => story.at < cursor).sort((a, b) => b.at - a.at).slice(0, PAGE_SIZE);
    const dates = page.map((story) => story.at);
    const oldestStoryDate = page.length === 0 ? undefined : Math.min(...dates);
    const newestStoryDate = page.length === 0 ? undefined : Math.max(...dates);
    const payload = feedPayload({ entries: page.map((story) => purchaseAt(story.itemId, story.at)), oldestStoryDate, newestStoryDate });
    return ok({
      document: { endpoint: 'fan_dash_feed_updates', payload, fetchedAt: at() },
      entryCount: page.length,
      oldestStoryDate: oldestStoryDate ?? null,
      newestStoryDate: newestStoryDate ?? null,
    });
  },
  async fetchReleasePage(url, key) {
    clock += REQUEST_MS;
    releasePages.push(key.itemId);
    releasePageUrls.push(url);
    return releasePage(key.itemId, key.itemType);
  },
};

/** Bandcamp signing the phone out mid-turn: the feed's answer and every probe after it say so. */
function signOut(): BandcampAnswer<never> {
  probe = { kind: 'logged_out' };
  return { kind: 'logged_out' };
}

function datedPage(itemId: number): BandcampAnswer<ReleasePage> {
  return ok({ kind: 'page', document: { endpoint: 'release_page', payload: releasePagePayload({ itemId }), fetchedAt: at() } });
}

function turn(budgetMs = 600_000, reason: GatherReason = 'open') {
  const wait = async (ms: number) => {
    clock += ms;
  };
  return runGatherTurn(session, sink, { now: () => clock, reason, budgetMs, wait });
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
  releasePageUrls = [];
  bandDetailsAsked = [];
  bandDetails = { kind: 'error', status: 429 };
  probe = ok(FAN);
  probes = 0;
  refuseFeed = () => null;
  releasePage = datedPage;
  followed = [];
  wishlisted = [];
  listsComplete = true;
  pokeMs = 0;
  asked = [];
});

describe('the feed walk', () => {
  test('a first walk takes the whole feed, and a poll after it stops at what the walk reached', async () => {
    feed = stories(23, 1000);
    assert.deepEqual(await turn(), { reason: 'open', outcome: 'done', walkPending: false, status: null, failedStep: null, feedRetried: false });
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
    assert.deepEqual(await turn(3_500), { reason: 'open', outcome: 'out_of_budget', walkPending: true, status: null, failedStep: null, feedRetried: false });
    assert.notEqual(gather.lastSuccessAt, null, 'a pending walk names its last feed read');
    assert.equal((await turn()).outcome, 'done');
    assert.equal(new Set(cursors).size, cursors.length, 'no page asked twice');
    assert.equal(await storyCount(), 40);
  });

  test('a walk holds time back for the release pages it has queued (ADR-0011)', async () => {
    feed = stories(200, 1000);
    await turn(12_000);
    assert.equal(gather.releasesDated, 0);
    releasePages = [];
    assert.deepEqual(await turn(12_000), { reason: 'open', outcome: 'out_of_budget', walkPending: true, status: null, failedStep: null, feedRetried: false });
    assert.equal(releasePages.length, 5);
    assert.equal(gather.releasesDated, 5);
  });

  test('the last success moves once the feed is in, before the release pages after it', async () => {
    feed = stories(3, 1000, 86_400);
    await turn();
    const before = gather.lastSuccessAt;
    assert.notEqual(before, null);

    clock += 15 * 60_000;
    // A poll of three pages, so a stamp on every feed answer would show as more than one new value.
    feed = [...stories(2 * PAGE_SIZE + 2, 2000, 60), ...feed];
    cursors = [];
    const polledFrom = clock;
    const seen: Pick<GatherState, 'phase' | 'lastSuccessAt'>[] = [];
    const watched = createGatherSink({
      db,
      setGather: (state) => {
        gather = state;
        seen.push({ phase: state.phase, lastSuccessAt: state.lastSuccessAt });
      },
      invalidate: () => undefined,
    });
    // The fold takes time on a phone, so the clock at the feed step's end is past the last page's landing.
    sink = {
      ...watched,
      async afterDocuments() {
        clock += 50;
        await watched.afterDocuments();
      },
    };
    await turn(600_000, 'refresh');
    assert.ok(releasePages.length > 0, 'the new Stories send the turn on to release pages');
    const dating = seen.findIndex((state) => state.phase === 'dating');
    assert.ok(dating > 0);
    const moved = seen.findIndex((state) => state.lastSuccessAt !== before);
    assert.ok(moved < dating && seen[moved]?.phase === 'walking', 'it moves as the feed step ends');
    assert.equal(cursors.length, 3);
    assert.deepEqual(
      [...new Set(seen.map((state) => state.lastSuccessAt))],
      [before, polledFrom + cursors.length * REQUEST_MS],
      'one new value, the moment the last feed page landed',
    );
    assert.equal(gather.lastSuccessAt, seen[moved]?.lastSuccessAt, 'the release pages after the feed do not move it');
  });

  test('a turn whose feed request fails leaves the last success where it was, whatever landed before it', async () => {
    // A first walk: the follow list and the poke land, then the first feed request fails.
    followed = [1, 2];
    feed = stories(3, 1000);
    refuseFeed = () => ({ kind: 'error', status: 503 });
    assert.equal((await turn()).outcome, 'failed');
    assert.equal(gather.lastSuccessAt, null);

    refuseFeed = () => null;
    await turn();
    const read = gather.lastSuccessAt;
    assert.notEqual(read, null);

    // Caught up: the poll's first page lands and its second fails.
    clock += 15 * 60_000;
    feed = [...stories(2 * PAGE_SIZE + 2, 2000, 60), ...feed];
    cursors = [];
    refuseFeed = (asked) => (asked === 1 ? { kind: 'unreachable' } : null);
    assert.equal((await turn(600_000, 'refresh')).outcome, 'failed');
    assert.equal(cursors.length, 2);
    assert.equal(gather.lastSuccessAt, read);
  });

  test('a turn signed out after a feed page landed leaves the last success where it was', async () => {
    feed = stories(3, 1000);
    await turn();
    const read = gather.lastSuccessAt;
    assert.notEqual(read, null);

    clock += 15 * 60_000;
    feed = [...stories(2 * PAGE_SIZE + 2, 2000, 60), ...feed];
    cursors = [];
    refuseFeed = (asked) => (asked === 1 ? signOut() : null);
    assert.equal((await turn(600_000, 'refresh')).outcome, 'paused');
    assert.equal(cursors.length, 2);
    assert.equal(gather.lastSuccessAt, read);
  });

  test('a turn the budget ends before its first feed answer leaves the last success where it was', async () => {
    // A first walk: the follow list lands and spends the budget before the poke.
    followed = [1, 2];
    feed = stories(3, 1000);
    assert.equal((await turn(REQUEST_MS)).outcome, 'out_of_budget');
    assert.deepEqual(cursors, []);
    assert.equal(gather.lastSuccessAt, null);

    await turn();
    const read = gather.lastSuccessAt;
    assert.notEqual(read, null);

    // Caught up: the poke lands and spends the budget before the poll's first page.
    clock += 15 * 60_000;
    cursors = [];
    pokeMs = REQUEST_MS;
    assert.equal((await turn(REQUEST_MS, 'refresh')).outcome, 'out_of_budget');
    assert.deepEqual(cursors, []);
    assert.equal(gather.lastSuccessAt, read);
  });
});

describe('the order of a turn (task 0046, decision 1)', () => {
  const firsts = () => [...new Set(asked)];

  test('while the first walk is pending the lists come before the feed, and once it is done the feed comes first', async () => {
    feed = stories(3, 1000);
    assert.equal((await turn()).outcome, 'done');
    assert.deepEqual(firsts(), ['wishlist', 'follows', 'feed']);

    clock += LIST_INTERVAL_MS;
    asked = [];
    assert.equal((await turn(600_000, 'refresh')).outcome, 'done');
    assert.deepEqual(asked, ['feed', 'wishlist', 'follows']);
  });

  test('a walk still held after the first is done keeps the lists before the feed', async () => {
    feed = stories(3, 1000);
    await turn();
    const newer = POLL_MAX_PAGES * PAGE_SIZE + 7;
    feed = [...stories(newer, 5000, 60), ...feed];
    clock += LIST_INTERVAL_MS;
    // A poll capped short of what the store holds walks on, and the budget ends the turn mid-walk.
    assert.equal((await turn((POLL_MAX_PAGES + 1) * REQUEST_MS, 'timer')).outcome, 'out_of_budget');
    assert.equal((await sink.readWalk())?.kind, 'feed_walk');
    clock += LIST_INTERVAL_MS;
    asked = [];
    await turn(600_000, 'timer');
    assert.deepEqual(firsts(), ['wishlist', 'follows', 'feed']);
  });

  test('a caught-up turn whose feed fails asks for no list after it (ADR-0017)', async () => {
    feed = stories(3, 1000);
    await turn();
    const listed = gather.wishlistFetchedAt;
    assert.notEqual(listed, null);

    clock += LIST_INTERVAL_MS;
    asked = [];
    refuseFeed = () => ({ kind: 'error', status: 503 });
    assert.equal((await turn(600_000, 'refresh')).outcome, 'failed');
    assert.deepEqual(asked, ['feed']);
    assert.equal(gather.wishlistFetchedAt, listed);
  });
});

describe('list freshness (task 0070)', () => {
  test('partial lists retain their additions and are asked on the next pull; only complete walks acquire the six-hour gate', async () => {
    await followBands([1]);
    await db.runAsync("insert into wishlist_items (item_type, item_id, last_seen_snapshot_at) values ('a', 1001, '')");
    followed = [2];
    wishlisted = [1000];
    listsComplete = false;
    bandDetails = ok({ kind: 'gone', status: 404 });
    feed = stories(3, 2000);
    const calls = () => ['wishlist', 'follows'].map((list) => asked.filter((request) => request === list).length);
    const memberships = async () => [
      (await db.getAllAsync<{ item_id: number }>('select item_id from wishlist_items order by item_id')).map((row) => row.item_id),
      (await sink.readFollowedBands()).map((page) => page.bandId).sort(),
    ];

    assert.equal((await turn(REQUEST_MS)).outcome, 'out_of_budget');
    assert.deepEqual(await memberships(), [[1000, 1001], [1, 2]], 'admitted partial pages stay additive');
    assert.notEqual(gather.wishlistAskedAt, null, 'the first attempt makes hearts available');
    const firstAsk = gather.wishlistAskedAt;
    assert.equal(gather.initialWalkDone, false);

    clock += 60_000;
    assert.equal((await turn(600_000, 'refresh')).outcome, 'done');
    assert.deepEqual(calls(), [2, 2], 'a pull asks both incomplete lists again');
    assert.deepEqual([gather.wishlistFetchedAt, gather.followsFetchedAt], [null, null]);
    assert.ok(gather.wishlistAskedAt !== null && gather.wishlistAskedAt > firstAsk!);
    assert.equal(gather.initialWalkDone, true, 'the held first walk resumes');
    assert.equal(await storyCount(), 3);

    listsComplete = true;
    clock += 60_000;
    await turn(600_000, 'refresh');
    assert.deepEqual(calls(), [3, 3]);
    const completed = [gather.wishlistFetchedAt, gather.followsFetchedAt];
    assert.ok(completed.every((stamp) => stamp !== null));
    const lastAsk = gather.wishlistAskedAt;
    clock += 60_000;
    await turn(600_000, 'refresh');
    assert.deepEqual(calls(), [3, 3], 'a completed read retains its six-hour gate');
    assert.deepEqual([gather.wishlistFetchedAt, gather.followsFetchedAt], completed);
    assert.equal(gather.wishlistAskedAt, lastAsk, 'skipping a fresh list is not an attempt');

    listsComplete = false;
    clock += LIST_INTERVAL_MS;
    await turn(600_000, 'refresh');
    assert.deepEqual(calls(), [4, 4]);
    assert.deepEqual([gather.wishlistFetchedAt, gather.followsFetchedAt], completed, 'a partial retry cannot refresh an older completed read');
    clock += 60_000;
    await turn(600_000, 'refresh');
    assert.deepEqual(calls(), [5, 5]);
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

  test('a first walk keeps each probe answer and its own last pages as samples for the fill (decision 5)', async () => {
    feed = [...stories(40, 1000), ...daily(12, 2000, 2014, 2, 10)];
    assert.equal((await turn(10_000)).outcome, 'out_of_budget');
    const held = await sink.readWalk();
    assert.ok(held !== null && held.samples !== undefined && held.recent !== undefined);
    assert.equal(held.samples.length, held.probeOldest.length, 'one sample per probe answer with entries');
    for (const sample of held.samples) {
      assert.ok(held.probeOldest.includes(sample.oldest) && sample.newest >= sample.oldest && sample.count > 0);
    }
    assert.equal(held.recent.length, Math.min(held.pagesDone, RATE_PAGES));
    assert.equal(held.recent.at(-1)?.oldest, held.olderThan, "the last page's oldest Story is the cursor");
    assert.ok(held.recent.every((page) => page.count === PAGE_SIZE));
  });

  test('a walk probed before decision 5 reads its samples once from the answers the probe landed', async () => {
    feed = [...stories(40, 1000), ...daily(12, 2000, 2014, 2, 10)];
    await turn(10_000);
    const held = await sink.readWalk();
    assert.ok(held?.samples !== undefined && held.samples.length > 0);
    const { samples, recent: _recent, ...before } = held;
    await writeKv(db, WALK_KEY, before);

    cursors = [];
    assert.equal((await turn(12_000)).outcome, 'out_of_budget');
    assert.equal(cursors[0], held.olderThan, 'the walk goes on from its cursor without probing again');
    const read = await sink.readWalk();
    const byDate = (list: readonly { oldest: number }[]) => [...list].sort((a, b) => a.oldest - b.oldest);
    assert.deepEqual(byDate(read?.samples ?? []), byDate(samples), 'the same three facts, from the Raw Documents');
    assert.equal(read?.recent?.at(-1)?.oldest, read?.olderThan, "the walk's own pages are kept again from here");
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
    refuseFeed = (asked) => (asked === 1 ? signOut() : null);
    assert.equal((await turn()).outcome, 'paused');
    assert.equal(gather.pausedReason, 'logged_out');
    const held = await sink.readWalk();
    assert.equal(held?.probed, false);

    refuseFeed = () => null;
    probe = ok(FAN);
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
    assert.deepEqual(await turn(), { reason: 'open', outcome: 'failed', walkPending: false, status: 429, failedStep: 'probe', feedRetried: false });
    assert.equal(gather.pausedReason, null);
    assert.equal(gather.lastError, 'bandcamp_error');
    assert.equal(gather.lastStatus, 429);
  });
});

describe('a feed page Bandcamp fails', () => {
  test('fails the turn with its status, and keeps the status beside the failure until a probe answers again', async () => {
    feed = stories(3, 1000);
    refuseFeed = () => ({ kind: 'error', status: 503 });
    assert.deepEqual(await turn(), { reason: 'open', outcome: 'failed', walkPending: true, status: 503, failedStep: 'depth_probe', feedRetried: false });
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
    assert.deepEqual(await turn(), { reason: 'open', outcome: 'failed', walkPending: true, status: null, failedStep: 'feed_page', feedRetried: false });
    assert.equal(gather.lastError, 'bandcamp_unreachable');
  });
});

describe('a feed answer that looks signed out (task 0066)', () => {
  /** A caught-up store whose next poll finds two new Stories. */
  async function caughtUp(): Promise<void> {
    feed = stories(3, 1000);
    await turn();
    clock += 15 * 60_000;
    feed = [...stories(2, 2000, 60), ...feed];
    cursors = [];
    probes = 0;
  }

  test('a 400 the probe calls signed in is asked again after the pause, and the poll lands', async () => {
    await caughtUp();
    const read = gather.lastSuccessAt;
    refuseFeed = (asked) => (asked === 0 ? { kind: 'error', status: 400 } : null);
    const before = clock;
    const summary = await turn(600_000, 'refresh');
    assert.deepEqual([summary.outcome, summary.failedStep, summary.feedRetried], ['done', null, true]);
    assert.equal(probes, 2, 'the turn probe and the recheck');
    assert.equal(cursors[1], cursors[0], 'the same page twice');
    assert.ok(clock - before >= FEED_RETRY_AFTER_MS);
    assert.equal(await storyCount(), 5);
    assert.notEqual(gather.lastSuccessAt, read);
  });

  test('a 400 the probe calls signed out pauses the turn as a sign-out', async () => {
    await caughtUp();
    refuseFeed = (asked) => (asked === 0 ? (probes > 1 ? null : ((probe = { kind: 'logged_out' }), { kind: 'error', status: 400 })) : null);
    const summary = await turn(600_000, 'refresh');
    assert.deepEqual([summary.outcome, summary.feedRetried], ['paused', false]);
    assert.equal(gather.pausedReason, 'logged_out');
    assert.equal(cursors.length, 1, 'nothing is asked after the probe');
  });

  test('a body that is not JSON twice fails the turn as a Bandcamp error with no status, not a sign-out', async () => {
    await caughtUp();
    refuseFeed = () => ({ kind: 'logged_out' });
    const summary = await turn(600_000, 'refresh');
    assert.deepEqual([summary.outcome, summary.status, summary.failedStep, summary.feedRetried], ['failed', 0, 'feed_page', true]);
    assert.equal(gather.pausedReason, null);
    assert.equal(gather.lastError, 'bandcamp_error');
    assert.equal(cursors.length, 2);
  });

  test('a refusal asks neither the probe nor the page again (ADR-0017)', async () => {
    await caughtUp();
    refuseFeed = () => ({ kind: 'error', status: 429 });
    const summary = await turn(600_000, 'refresh');
    assert.deepEqual([summary.outcome, summary.status, summary.feedRetried], ['failed', 429, false]);
    assert.equal(probes, 1);
    assert.equal(cursors.length, 1);
  });

  test('a turn rechecks once: a second suspect answer after a retry that landed fails it', async () => {
    // A first walk's depth probe: its second answer is retried as the third, and its fourth is not.
    feed = stories(4 * PAGE_SIZE, 1000);
    refuseFeed = (asked) => (asked === 1 || asked === 3 ? { kind: 'error', status: 400 } : null);
    const summary = await turn();
    assert.deepEqual([summary.outcome, summary.status, summary.failedStep, summary.feedRetried], ['failed', 400, 'depth_probe', true]);
    assert.equal(probes, 2);
    assert.equal(cursors.length, 4);
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

describe('Upcoming Releases (task 0041, decision 8)', () => {
  const albumPage = (out: readonly number[]) =>
    releasePagePayload({ itemId: PREORDER_ITEM_ID, itemUrl: PREORDER_URL, tralbum: preorderTralbumBlob({}, out) });
  const trackPage = (itemId: number): BandcampAnswer<ReleasePage> => {
    const tralbum = preorderTrackPageBlob(3, '04 Oct 2026 20:36:00 GMT');
    return ok({ kind: 'page', document: { endpoint: 'release_page', payload: releasePagePayload({ itemType: 't', itemId, tralbum }), fetchedAt: at() } });
  };
  const dropDays = async () => (await listDrops(db)).map((drop) => [drop.day, drop.tracksOut]);

  /** Held from four days back: the feed's pre-order and its page, one Track playing; its page now plays a second. */
  async function holdPreorder(): Promise<void> {
    clock = Date.UTC(2026, 9, 5, 12);
    const heldAt = new Date(Date.UTC(2026, 9, 1, 8)).toISOString();
    await insertRawDocument(db, { endpoint: 'fan_dash_feed_updates', payload: feedPayload({ entries: [preorderNrEntry()] }), fetchedAt: heldAt });
    await insertRawDocument(db, { endpoint: 'release_page', payload: albumPage([2]), fetchedAt: heldAt });
    await fold(db);
    releasePage = (itemId, itemType) => {
      if (itemType === 'a' && itemId !== PREORDER_ITEM_ID) return datedPage(itemId);
      if (itemType === 'a') return ok({ kind: 'page', document: { endpoint: 'release_page', payload: albumPage([2, 3]), fetchedAt: at() } });
      return trackPage(itemId);
    };
  }

  test('owed Tracks and Upcoming reads progress under an undated backlog within the walking and caught-up quotas (task 0072)', async () => {
    await holdPreorder();
    await insertRawDocument(db, { endpoint: 'release_page', payload: albumPage([2, 3]), fetchedAt: '2026-10-03T12:00:00.000Z' });
    await fold(db);
    feed = stories(70, 1000);
    assert.equal((await turn()).outcome, 'done');
    assert.equal(releasePages.length, 5);
    assert.ok(releasePages.includes(preorderTrackId(3)), 'an owed Drop Track gets a slot despite the undated backlog');
    assert.ok(releasePages.includes(PREORDER_ITEM_ID), 'a stale Upcoming album gets a slot too');
    assert.ok(releasePages.some((id) => id >= 1000 && id < 1070), 'undated history also progresses');

    // Another Track comes out while ordinary history still fills more than a turn.
    clock += 2 * DAY_S * 1000;
    releasePages = [];
    releasePage = (itemId, itemType) => itemType === 'a' && itemId === PREORDER_ITEM_ID
      ? ok({ kind: 'page', document: { endpoint: 'release_page', payload: albumPage([2, 3, 4]), fetchedAt: at() } })
      : itemType === 't' ? trackPage(itemId) : datedPage(itemId);
    await turn();
    assert.equal(releasePages.length, 25);
    assert.ok(releasePages.includes(PREORDER_ITEM_ID));
    assert.ok(releasePages.includes(preorderTrackId(4)), 'new Drop work shares the same quota');
    assert.equal(new Set(releasePages).size, releasePages.length, 'the pass does not ask a page twice');
  });

  test('a walking turn reserves time for owed and Upcoming pages when no undated Release is held (task 0072)', async () => {
    await holdPreorder();
    await insertRawDocument(db, { endpoint: 'release_page', payload: albumPage([2, 3]), fetchedAt: '2026-10-03T12:00:00.000Z' });
    await fold(db);
    assert.deepEqual(await readUndatedReleases(db, 5, new Date(clock)), []);
    feed = stories(100, 1000);
    const summary = await turn(10 * REQUEST_MS);
    assert.equal(summary.outcome, 'out_of_budget');
    assert.equal(summary.walkPending, true);
    assert.ok(releasePages.includes(preorderTrackId(3)), 'the feed leaves room for the owed Track');
    assert.ok(releasePages.includes(PREORDER_ITEM_ID), 'the feed leaves room for the Upcoming album');
    assert.ok(releasePages.length <= 5);
  });

  test('new Drop Track pages cannot consume the allowance before another planned Upcoming album (task 0072)', async () => {
    await holdPreorder();
    const manyTracks = (playing: boolean) => Array.from({ length: 30 }, (_, i) => ({
      id: playing ? 9000 + i : null, track_id: 9000 + i, track_num: i + 1, title: `Track ${i + 1}`,
      streaming: 1, unreleased_track: !playing,
      file: playing ? { 'mp3-128': `https://stream.invalid/${9000 + i}` } : null,
      title_link: playing ? `/track/t${9000 + i}` : null,
    }));
    const otherId = 7000;
    await insertRawDocument(db, {
      endpoint: 'fan_dash_feed_updates', payload: feedPayload({ entries: [preorderNrEntry({ item_id: otherId, item_url: 'https://nightgraft.bandcamp.com/album/other' })] }),
      fetchedAt: '2026-10-01T08:00:00.000Z',
    });
    await insertRawDocument(db, { endpoint: 'release_page', payload: releasePagePayload({ itemId: PREORDER_ITEM_ID, itemUrl: PREORDER_URL, tralbum: preorderTralbumBlob({ trackinfo: manyTracks(false) }) }), fetchedAt: '2026-10-01T09:00:00.000Z' });
    await insertRawDocument(db, { endpoint: 'release_page', payload: releasePagePayload({ itemId: otherId, tralbum: preorderTralbumBlob() }), fetchedAt: '2026-10-02T09:00:00.000Z' });
    await fold(db);
    await sink.patchGatherState({ initialWalkDone: true });
    releasePage = (itemId, itemType) => {
      if (itemType === 'a' && itemId === PREORDER_ITEM_ID) return ok({ kind: 'page', document: { endpoint: 'release_page', payload: releasePagePayload({ itemId, itemUrl: PREORDER_URL, tralbum: preorderTralbumBlob({ trackinfo: manyTracks(true) }) }), fetchedAt: at() } });
      if (itemType === 't') return ok({ kind: 'page', document: { endpoint: 'release_page', payload: releasePagePayload({
        itemType, itemId, itemUrl: `https://nightgraft.bandcamp.com/track/t${itemId}`,
        tralbum: { current: { id: itemId, album_id: PREORDER_ITEM_ID, mod_date: '04 Oct 2026 20:36:00 GMT' }, album_release_date: '13 Oct 2026 00:00:00 GMT', album_url: '/album/moth-season', trackinfo: [manyTracks(true)[itemId - 9000]] },
      }), fetchedAt: at() } });
      return datedPage(itemId);
    };

    await turn();
    assert.ok(releasePages.includes(otherId), 'a second Upcoming album is read before nested Drop pages spend the pass');
    assert.equal(releasePages.length, 25);
    assert.equal(new Set(releasePages).size, 25);
    const requested = new Set(releasePages);
    const answerPage = releasePage;
    releasePages = [];
    releasePage = () => ({ kind: 'error', status: 503 });
    await turn();
    assert.equal(releasePages.length, 1, 'a refused request stops the deferred pass');
    const deferred = releasePages[0];
    assert.ok(deferred !== undefined);
    assert.ok(!requested.has(deferred), 'the quota left this Track unread');

    releasePages = [];
    releasePage = answerPage;
    await turn();
    assert.equal(releasePages.length, 7, 'the next pass dates all seven Tracks the quota left');
    assert.ok(releasePages.every((itemId) => itemId >= 9000 && itemId < 9030 && !requested.has(itemId)));
  });

  for (const { newest, heldParent } of [
    { newest: false, heldParent: false }, { newest: true, heldParent: false }, { newest: true, heldParent: true },
  ]) {
    test(`an early Track ${heldParent ? 'with its parent already queued behind six albums' : newest ? 'at the head' : 'behind ordinary history'} completes its future album in the same bounded pass (task 0072)`, async () => {
      clock = Date.UTC(2026, 9, 12, 12);
      const trackId = preorderTrackId(2);
      const trackUrl = 'https://label.example/track/early-track';
      const albumUrl = 'https://label.example/album/future-ep';
      const albumDate = '06 Nov 2026 00:00:00 GMT';
      const purchase = preorderTrackPurchase(2, {
        is_preorder: false, item_url: trackUrl, album_title: 'Future EP',
        story_date: newest ? '12 Oct 2026 11:30:00 GMT' : '02 Oct 2026 18:19:06 GMT',
        purchased: newest ? '12 Oct 2026 11:30:00 GMT' : '02 Oct 2026 18:19:06 GMT',
      });
      await insertRawDocument(db, {
        endpoint: 'fan_dash_feed_updates', payload: feedPayload({ entries: [purchase, ...Array.from({ length: 60 }, (_, i) => purchaseAt(1000 + i, Date.UTC(2026, 9, 11, 12) / 1000 - i))] }),
        fetchedAt: at(),
      });
      await fold(db);
      if (heldParent) {
        await followBands([BAND_ID]);
        await insertRawDocument(db, { endpoint: 'band_details', fetchedAt: at(), payload: bandDetailsPayload({ items: [
          ...Array.from({ length: 6 }, (_, i) => discographyItem({ item_id: 8000 + i, release_date: albumDate, item_url: `https://label.example/album/other-${i}` })),
          discographyItem({ item_id: PREORDER_ITEM_ID, release_date: albumDate, item_url: albumUrl }),
        ] }) });
        await fold(db);
        assert.equal((await sink.readUpcomingDue(clock, 25))[6]?.itemId, PREORDER_ITEM_ID, 'the parent is already in the planned Upcoming queue');
        await sink.patchGatherState({ initialWalkDone: true });
        bandDetails = ok({ kind: 'gone', status: 404 });
      }
      const trackBlob = { ...preorderTrackPageBlob(2, '05 Oct 2026 14:50:50 GMT'), album_release_date: albumDate, album_url: '/album/future-ep' };
      const baseAlbum = preorderTralbumBlob();
      const albumBlob = {
        ...baseAlbum, album_release_date: albumDate,
        current: { ...(baseAlbum.current as Record<string, unknown>), release_date: albumDate },
        trackinfo: [...(baseAlbum.trackinfo as unknown[]), { id: null, track_id: 9991, track_num: 5, title: 'Not out', streaming: 1, unreleased_track: true, file: null }],
      };
      releasePage = (itemId, itemType) => {
        if (itemType === 't') return ok({ kind: 'page', document: { endpoint: 'release_page', payload: releasePagePayload({ itemType, itemId, itemUrl: trackUrl, tralbum: trackBlob }), fetchedAt: at() } });
        if (itemId === PREORDER_ITEM_ID) return ok({ kind: 'page', document: { endpoint: 'release_page', payload: releasePagePayload({ itemId, itemUrl: albumUrl, tralbum: albumBlob }), fetchedAt: at() } });
        return datedPage(itemId);
      };

      await turn(heldParent ? 6 * REQUEST_MS : 600_000);
      assert.ok(releasePages.includes(trackId), 'known absent-parent Tracks are reached before unrelated undated history');
      assert.ok(releasePages.includes(PREORDER_ITEM_ID), 'the Track evidence schedules the album page inside this pass');
      assert.equal(releasePageUrls[releasePages.indexOf(PREORDER_ITEM_ID)], albumUrl, 'use the URL stated by the Track page');
      assert.equal(releasePages.length, 5);
      const album = (await listUpcomingReleases(db, new Date(clock))).find((release) => release.itemId === PREORDER_ITEM_ID);
      assert.ok(album);
      assert.deepEqual([album.numStreamableTracks, album.numTracks], [1, 5]);
      if (heldParent) {
        assert.equal(releasePages.filter((itemId) => itemId === PREORDER_ITEM_ID).length, 1, 'promotion does not duplicate the parent request');
      }
    });
  }

  for (const scenario of [
    { name: 'missing album title', purchase: { album_title: null }, page: {}, failures: 0 },
    { name: 'missing album URL', purchase: {}, page: { album_url: null }, failures: 0 },
    { name: 'album date is not future', purchase: {}, page: { album_release_date: '12 Oct 2026 00:00:00 GMT' }, failures: 0 },
    { name: 'failed album attempt waits a day', purchase: {}, page: {}, failures: 1 },
    { name: 'three failed album attempts wait a week', purchase: {}, page: {}, failures: 3 },
  ]) {
    test(`early Track follow-up respects ${scenario.name} (task 0072)`, async () => {
      clock = Date.UTC(2026, 9, 12, 12);
      const trackId = preorderTrackId(2);
      await insertRawDocument(db, { endpoint: 'fan_dash_feed_updates', payload: feedPayload({ entries: [preorderTrackPurchase(2, { is_preorder: false, ...scenario.purchase })] }), fetchedAt: at() });
      await fold(db);
      for (let failure = 0; failure < scenario.failures; failure += 1) {
        await markReleasePageAttempt(db, { itemType: 'a', itemId: PREORDER_ITEM_ID }, 'failed', new Date(clock));
      }
      const baseAlbum = preorderTralbumBlob();
      const albumDate = '06 Nov 2026 00:00:00 GMT';
      releasePage = (itemId, itemType) => ok({ kind: 'page', document: { endpoint: 'release_page', fetchedAt: at(), payload: releasePagePayload({
        itemType, itemId,
        tralbum: itemType === 't'
          ? { ...preorderTrackPageBlob(2, '05 Oct 2026 14:50:50 GMT'), album_release_date: albumDate, ...scenario.page }
          : { ...baseAlbum, album_release_date: albumDate, current: { ...(baseAlbum.current as Record<string, unknown>), release_date: albumDate } },
      }) } });

      await turn();
      assert.deepEqual(releasePages, [trackId], 'the admitted Track does not authorize this album request yet');
      const held = await db.getFirstAsync<{ num_tracks: number | null }>("select num_tracks from releases where item_type = 'a' and item_id = ?", [PREORDER_ITEM_ID]);
      assert.deepEqual(held === null ? null : { ...held }, scenario.failures > 0 ? { num_tracks: null } : null);
      if (scenario.failures > 0) {
        clock += scenario.failures === 3 ? BACKOFF_MS : RETRY_AFTER_MS;
        releasePages = [];
        await turn();
        assert.deepEqual(releasePages, [PREORDER_ITEM_ID], 'the due parent is read after its established wait');
      }
    });
  }

  test('a page a day old is read again after the undated, with the Track pages of the Tracks it let out', async () => {
    await holdPreorder();
    feed = stories(1, 1000);
    await turn();
    assert.deepEqual(releasePages, [1000, PREORDER_ITEM_ID, preorderTrackId(3)]);
    assert.equal(releasePageUrls[2], 'https://nightgraft.bandcamp.com/track/wing-dust');
    assert.deepEqual(await dropDays(), [['2026-10-04', 2], ['2026-09-29', 1]], 'the Track page dates the Drop the read found');

    releasePages = [];
    await turn(600_000, 'timer');
    assert.deepEqual(releasePages, [], 'read today, and the feed names no more');
  });

  test('a Track page the budget or a refusal left unread is asked on a later turn, and dates the Drop then', async () => {
    await holdPreorder();
    feed = stories(1, 1000);
    const answerPage = releasePage;
    releasePage = (itemId, itemType) => {
      const answer = answerPage(itemId, itemType);
      if (itemId === PREORDER_ITEM_ID) clock += 600_000;
      return answer;
    };
    assert.equal((await turn()).outcome, 'out_of_budget');
    assert.deepEqual(releasePages, [1000, PREORDER_ITEM_ID]);
    assert.deepEqual(await dropDays(), [['2026-10-05', 2], ['2026-09-29', 1]]);

    releasePages = [];
    releasePage = () => ({ kind: 'error', status: 503 });
    await turn(600_000, 'timer');
    assert.deepEqual(releasePages, [preorderTrackId(3)]);

    releasePages = [];
    releasePage = (itemId) => trackPage(itemId);
    await turn(600_000, 'timer');
    assert.deepEqual(releasePages, [preorderTrackId(3)]);
    assert.equal(releasePageUrls.at(-1), 'https://nightgraft.bandcamp.com/track/wing-dust');
    assert.deepEqual(await dropDays(), [['2026-10-04', 2], ['2026-09-29', 1]]);

    releasePages = [];
    await turn(600_000, 'timer');
    assert.deepEqual(releasePages, [], 'the Drop owes no Track page');
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

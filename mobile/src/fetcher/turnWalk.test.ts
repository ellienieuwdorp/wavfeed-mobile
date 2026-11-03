/// <reference types="node" />
/** Gather turns walking the feed: a first walk and the polls after it, the order of a turn and how fresh the lists stay. */
import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';

import { rig, resetRig, PAGE_SIZE, REQUEST_MS, stories, ok, signOut, turn, followBands, storyCount } from '../../test/gatherRig';
import { createGatherSink } from '../state/gatherSink';
import { type GatherState } from './sink';
import { LIST_INTERVAL_MS, POLL_MAX_PAGES } from './turn';

beforeEach(resetRig);

describe('the feed walk', () => {
  test('a first walk takes the whole feed, and a poll after it stops at what the walk reached', async () => {
    rig.feed = stories(23, 1000);
    assert.deepEqual(await turn(), { reason: 'open', outcome: 'done', walkPending: false, status: null, failedStep: null, feedRetried: false });
    assert.equal(await storyCount(), 23);
    assert.equal(rig.gather.newestStoryDate, rig.feed[0]?.at);

    rig.clock += 15 * 60_000;
    rig.feed = [...stories(2, 2000, 60), ...rig.feed];
    rig.cursors = [];
    assert.equal((await turn(600_000, 'timer')).outcome, 'done');
    assert.equal(rig.cursors.length, 1, 'the first page already reaches held Stories, and a poll asks no depth probe');
    assert.equal(await storyCount(), 25);
  });

  test('a poll that reaches its page cap before what it holds keeps walking (audit B1)', async () => {
    rig.feed = stories(3, 1000, 86_400);
    await turn();
    const newer = POLL_MAX_PAGES * PAGE_SIZE + 7;
    rig.feed = [...stories(newer, 5000, 60), ...rig.feed];
    assert.equal((await turn(600_000, 'timer')).outcome, 'done');
    assert.equal(await storyCount(), 3 + newer);
  });

  test('a window Bandcamp serves again ends the walk instead of running to the cap', async () => {
    rig.feed = stories(40, 1000);
    rig.replayFloor = rig.feed[PAGE_SIZE - 1]?.at ?? null;
    assert.equal((await turn()).outcome, 'done');
    assert.ok(rig.cursors.length < 5, `asked ${rig.cursors.length} pages`);
  });

  test('a turn out of budget resumes at its cursor', async () => {
    rig.feed = stories(40, 1000);
    assert.deepEqual(await turn(3_500), { reason: 'open', outcome: 'out_of_budget', walkPending: true, status: null, failedStep: null, feedRetried: false });
    assert.notEqual(rig.gather.lastSuccessAt, null, 'a pending walk names its last feed read');
    assert.equal((await turn()).outcome, 'done');
    assert.equal(new Set(rig.cursors).size, rig.cursors.length, 'no page asked twice');
    assert.equal(await storyCount(), 40);
  });

  test('a walk holds time back for the release pages it has queued (ADR-0011)', async () => {
    rig.feed = stories(200, 1000);
    await turn(12_000);
    assert.equal(rig.gather.releasesDated, 0);
    rig.releasePages = [];
    assert.deepEqual(await turn(12_000), { reason: 'open', outcome: 'out_of_budget', walkPending: true, status: null, failedStep: null, feedRetried: false });
    assert.equal(rig.releasePages.length, 5);
    assert.equal(rig.gather.releasesDated, 5);
  });

  test('the last success moves once the feed is in, before the release pages after it', async () => {
    rig.feed = stories(3, 1000, 86_400);
    await turn();
    const before = rig.gather.lastSuccessAt;
    assert.notEqual(before, null);

    rig.clock += 15 * 60_000;
    // A poll of three pages, so a stamp on every feed answer would show as more than one new value.
    rig.feed = [...stories(2 * PAGE_SIZE + 2, 2000, 60), ...rig.feed];
    rig.cursors = [];
    const polledFrom = rig.clock;
    const seen: Pick<GatherState, 'phase' | 'lastSuccessAt'>[] = [];
    const watched = createGatherSink({
      db: rig.db,
      setGather: (state) => {
        rig.gather = state;
        seen.push({ phase: state.phase, lastSuccessAt: state.lastSuccessAt });
      },
      invalidate: () => undefined,
    });
    // The fold takes time on a phone, so the clock at the feed step's end is past the last page's landing.
    rig.sink = {
      ...watched,
      async afterDocuments() {
        rig.clock += 50;
        await watched.afterDocuments();
      },
    };
    await turn(600_000, 'refresh');
    assert.ok(rig.releasePages.length > 0, 'the new Stories send the turn on to release pages');
    const dating = seen.findIndex((state) => state.phase === 'dating');
    assert.ok(dating > 0);
    const moved = seen.findIndex((state) => state.lastSuccessAt !== before);
    assert.ok(moved < dating && seen[moved]?.phase === 'walking', 'it moves as the feed step ends');
    assert.equal(rig.cursors.length, 3);
    assert.deepEqual(
      [...new Set(seen.map((state) => state.lastSuccessAt))],
      [before, polledFrom + rig.cursors.length * REQUEST_MS],
      'one new value, the moment the last feed page landed',
    );
    assert.equal(rig.gather.lastSuccessAt, seen[moved].lastSuccessAt, 'the release pages after the feed do not move it');
  });

  test('a turn whose feed request fails leaves the last success where it was, whatever landed before it', async () => {
    // A first walk: the follow list and the poke land, then the first feed request fails.
    rig.followed = [1, 2];
    rig.feed = stories(3, 1000);
    rig.refuseFeed = () => ({ kind: 'error', status: 503 });
    assert.equal((await turn()).outcome, 'failed');
    assert.equal(rig.gather.lastSuccessAt, null);

    rig.refuseFeed = () => null;
    await turn();
    const read = rig.gather.lastSuccessAt;
    assert.notEqual(read, null);

    // Caught up: the poll's first page lands and its second fails.
    rig.clock += 15 * 60_000;
    rig.feed = [...stories(2 * PAGE_SIZE + 2, 2000, 60), ...rig.feed];
    rig.cursors = [];
    rig.refuseFeed = (asked) => (asked === 1 ? { kind: 'unreachable' } : null);
    assert.equal((await turn(600_000, 'refresh')).outcome, 'failed');
    assert.equal(rig.cursors.length, 2);
    assert.equal(rig.gather.lastSuccessAt, read);
  });

  test('a turn signed out after a feed page landed leaves the last success where it was', async () => {
    rig.feed = stories(3, 1000);
    await turn();
    const read = rig.gather.lastSuccessAt;
    assert.notEqual(read, null);

    rig.clock += 15 * 60_000;
    rig.feed = [...stories(2 * PAGE_SIZE + 2, 2000, 60), ...rig.feed];
    rig.cursors = [];
    rig.refuseFeed = (asked) => (asked === 1 ? signOut() : null);
    assert.equal((await turn(600_000, 'refresh')).outcome, 'paused');
    assert.equal(rig.cursors.length, 2);
    assert.equal(rig.gather.lastSuccessAt, read);
  });

  test('a turn the budget ends before its first feed answer leaves the last success where it was', async () => {
    // A first walk: the follow list lands and spends the budget before the poke.
    rig.followed = [1, 2];
    rig.feed = stories(3, 1000);
    assert.equal((await turn(REQUEST_MS)).outcome, 'out_of_budget');
    assert.deepEqual(rig.cursors, []);
    assert.equal(rig.gather.lastSuccessAt, null);

    await turn();
    const read = rig.gather.lastSuccessAt;
    assert.notEqual(read, null);

    // Caught up: the poke lands and spends the budget before the poll's first page.
    rig.clock += 15 * 60_000;
    rig.cursors = [];
    rig.pokeMs = REQUEST_MS;
    assert.equal((await turn(REQUEST_MS, 'refresh')).outcome, 'out_of_budget');
    assert.deepEqual(rig.cursors, []);
    assert.equal(rig.gather.lastSuccessAt, read);
  });
});

describe('the order of a turn', () => {
  const firsts = () => [...new Set(rig.asked)];

  test('while the first walk is pending the lists come before the feed, and once it is done the feed comes first', async () => {
    rig.feed = stories(3, 1000);
    assert.equal((await turn()).outcome, 'done');
    assert.deepEqual(firsts(), ['wishlist', 'follows', 'feed']);

    rig.clock += LIST_INTERVAL_MS;
    rig.asked = [];
    assert.equal((await turn(600_000, 'refresh')).outcome, 'done');
    assert.deepEqual(rig.asked, ['feed', 'wishlist', 'follows']);
  });

  test('a walk still held after the first is done keeps the lists before the feed', async () => {
    rig.feed = stories(3, 1000);
    await turn();
    const newer = POLL_MAX_PAGES * PAGE_SIZE + 7;
    rig.feed = [...stories(newer, 5000, 60), ...rig.feed];
    rig.clock += LIST_INTERVAL_MS;
    // A poll capped short of what the store holds walks on, and the budget ends the turn mid-walk.
    assert.equal((await turn((POLL_MAX_PAGES + 1) * REQUEST_MS, 'timer')).outcome, 'out_of_budget');
    assert.equal((await rig.sink.readWalk())?.kind, 'feed_walk');
    rig.clock += LIST_INTERVAL_MS;
    rig.asked = [];
    await turn(600_000, 'timer');
    assert.deepEqual(firsts(), ['wishlist', 'follows', 'feed']);
  });

  test('a caught-up turn whose feed fails asks for no list after it (ADR-0017)', async () => {
    rig.feed = stories(3, 1000);
    await turn();
    const listed = rig.gather.wishlistFetchedAt;
    assert.notEqual(listed, null);

    rig.clock += LIST_INTERVAL_MS;
    rig.asked = [];
    rig.refuseFeed = () => ({ kind: 'error', status: 503 });
    assert.equal((await turn(600_000, 'refresh')).outcome, 'failed');
    assert.deepEqual(rig.asked, ['feed']);
    assert.equal(rig.gather.wishlistFetchedAt, listed);
  });
});

describe('list freshness', () => {
  test('partial lists retain their additions and are asked on the next pull; only complete walks acquire the six-hour gate', async () => {
    await followBands([1]);
    await rig.db.runAsync("insert into wishlist_items (item_type, item_id, last_seen_snapshot_at) values ('a', 1001, '')");
    rig.followed = [2];
    rig.wishlisted = [1000];
    rig.listsComplete = false;
    rig.bandDetails = ok({ kind: 'gone', status: 404 });
    rig.feed = stories(3, 2000);
    const calls = () => ['wishlist', 'follows'].map((list) => rig.asked.filter((request) => request === list).length);
    const memberships = async () => [
      (await rig.db.getAllAsync<{ item_id: number }>('select item_id from wishlist_items order by item_id')).map((row) => row.item_id),
      (await rig.sink.readFollowedBands()).map((page) => page.bandId).sort((a, b) => a - b),
    ];

    assert.equal((await turn(REQUEST_MS)).outcome, 'out_of_budget');
    assert.deepEqual(await memberships(), [[1000, 1001], [1, 2]], 'admitted partial pages stay additive');
    const firstAsk = rig.gather.wishlistAskedAt;
    assert.ok(firstAsk !== null, 'the first attempt makes hearts available');
    assert.equal(rig.gather.initialWalkDone, false);

    rig.clock += 60_000;
    assert.equal((await turn(600_000, 'refresh')).outcome, 'done');
    assert.deepEqual(calls(), [2, 2], 'a pull asks both incomplete lists again');
    assert.deepEqual([rig.gather.wishlistFetchedAt, rig.gather.followsFetchedAt], [null, null]);
    assert.ok(rig.gather.wishlistAskedAt !== null && rig.gather.wishlistAskedAt > firstAsk);
    assert.equal(rig.gather.initialWalkDone, true, 'the held first walk resumes');
    assert.equal(await storyCount(), 3);

    rig.listsComplete = true;
    rig.clock += 60_000;
    await turn(600_000, 'refresh');
    assert.deepEqual(calls(), [3, 3]);
    const completed = [rig.gather.wishlistFetchedAt, rig.gather.followsFetchedAt];
    assert.ok(completed.every((stamp) => stamp !== null));
    const lastAsk = rig.gather.wishlistAskedAt;
    rig.clock += 60_000;
    await turn(600_000, 'refresh');
    assert.deepEqual(calls(), [3, 3], 'a completed read retains its six-hour gate');
    assert.deepEqual([rig.gather.wishlistFetchedAt, rig.gather.followsFetchedAt], completed);
    assert.equal(rig.gather.wishlistAskedAt, lastAsk, 'skipping a fresh list is not an attempt');

    rig.listsComplete = false;
    rig.clock += LIST_INTERVAL_MS;
    await turn(600_000, 'refresh');
    assert.deepEqual(calls(), [4, 4]);
    assert.deepEqual([rig.gather.wishlistFetchedAt, rig.gather.followsFetchedAt], completed, 'a partial retry cannot refresh an older completed read');
    rig.clock += 60_000;
    await turn(600_000, 'refresh');
    assert.deepEqual(calls(), [5, 5]);
  });
});

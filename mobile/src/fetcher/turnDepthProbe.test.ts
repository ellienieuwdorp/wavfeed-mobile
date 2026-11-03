/// <reference types="node" />
/** Gather turns with the depth probe: the binary search for a first walk's oldest Story, its samples and its cut-short cases. */
import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';

import { rig, resetRig, START, PAGE_SIZE, FAN, START_S, DAY_S, stories, daily, ok, signOut, turn, storyCount } from '../../test/gatherRig';
import { WALK_KEY } from '../state/gatherSink';
import { writeKv } from '../store/kv';
import { DEPTH_PROBE_RESOLUTION_S, POLL_MAX_PAGES, RATE_PAGES } from './turn';

beforeEach(resetRig);

describe('the depth probe', () => {
  test('a first walk finds the oldest Story first, and every Story counts once, when the walk reaches it', async () => {
    rig.feed = [...stories(40, 1000), ...daily(12, 2000, 2014, 2, 10)];
    const oldest = Math.min(...rig.feed.map((story) => story.at));
    assert.equal((await turn(10_000)).outcome, 'out_of_budget');

    const held = await rig.sink.readWalk();
    assert.ok(held?.probed && held.floor !== null);
    assert.ok(held.floor >= oldest && held.floor - oldest <= DEPTH_PROBE_RESOLUTION_S, `floor ${held.floor}`);
    assert.equal(rig.gather.storiesSoFar, held.pagesDone * PAGE_SIZE, 'only the walk counts');
    assert.ok((await storyCount()) > rig.gather.storiesSoFar, "the probe's answers are folded");

    rig.cursors = [];
    assert.equal((await turn()).outcome, 'done');
    assert.equal(rig.cursors[0], held.olderThan, 'a resumed walk goes on from its cursor without probing again');
    assert.equal(rig.gather.storiesSoFar, rig.feed.length);
    assert.equal(await storyCount(), rig.feed.length);
  });

  test('a first walk keeps each probe answer and its own last pages as samples for the fill', async () => {
    rig.feed = [...stories(40, 1000), ...daily(12, 2000, 2014, 2, 10)];
    assert.equal((await turn(10_000)).outcome, 'out_of_budget');
    const held = await rig.sink.readWalk();
    assert.ok(held !== null && held.samples !== undefined && held.recent !== undefined);
    assert.equal(held.samples.length, held.probeOldest.length, 'one sample per probe answer with entries');
    for (const sample of held.samples) {
      assert.ok(held.probeOldest.includes(sample.oldest) && sample.newest >= sample.oldest && sample.count > 0);
    }
    assert.equal(held.recent.length, Math.min(held.pagesDone, RATE_PAGES));
    assert.equal(held.recent.at(-1)?.oldest, held.olderThan, "the last page's oldest Story is the cursor");
    assert.ok(held.recent.every((page) => page.count === PAGE_SIZE));
  });

  test('a walk probed before the walk kept samples reads them once from the answers the probe landed', async () => {
    rig.feed = [...stories(40, 1000), ...daily(12, 2000, 2014, 2, 10)];
    await turn(10_000);
    const held = await rig.sink.readWalk();
    assert.ok(held?.samples !== undefined && held.samples.length > 0);
    const { samples, recent: _recent, ...before } = held;
    await writeKv(rig.db, WALK_KEY, before);

    rig.cursors = [];
    assert.equal((await turn(12_000)).outcome, 'out_of_budget');
    assert.equal(rig.cursors[0], held.olderThan, 'the walk goes on from its cursor without probing again');
    const read = await rig.sink.readWalk();
    const byDate = (list: readonly { oldest: number }[]) => [...list].sort((a, b) => a.oldest - b.oldest);
    assert.deepEqual(byDate(read?.samples ?? []), byDate(samples), 'the same three facts, from the Raw Documents');
    assert.equal(read?.recent?.at(-1)?.oldest, read?.olderThan, "the walk's own pages are kept again from here");
  });

  test('pages identical to what the probe landed do not end a first walk as already held', async () => {
    // The probe lands the 2016 and the 2011 runs, then finds nothing older than 2010-12-10; the walk meets both runs
    // again, byte for byte, before the 2010 run it never saw.
    rig.feed = [...stories(5, 1000), ...daily(5, 2000, 2016, 5, 1), ...daily(5, 3000, 2011, 0, 1), ...daily(5, 4000, 2010, 11, 20)];
    assert.equal((await turn()).outcome, 'done');
    assert.equal(await storyCount(), rig.feed.length);
    assert.equal(rig.gather.storiesSoFar, rig.feed.length);
  });

  test('a probe the budget cuts short searches on in the next turn, down to the oldest Story', async () => {
    // Four years of Stories four days apart, far below the first answer's oldest.
    rig.feed = [...stories(40, 1000), ...stories(360, 2000, START_S - Date.UTC(2014, 2, 10) / 1000, 4 * DAY_S)];
    const oldest = Math.min(...rig.feed.map((story) => story.at));
    assert.equal((await turn(2_500)).outcome, 'out_of_budget');
    assert.equal((await rig.sink.readWalk())?.probed, false);

    assert.equal((await turn(20_000)).outcome, 'out_of_budget');
    const held = await rig.sink.readWalk();
    assert.ok(held?.probed && held.floor !== null);
    assert.ok(held.floor >= oldest && held.floor - oldest <= DEPTH_PROBE_RESOLUTION_S, `floor ${held.floor}`);
  });

  test('a turn killed between counting a page the probe landed and moving the cursor counts it once', async () => {
    rig.feed = [...stories(5, 1000), ...daily(5, 2000, 2016, 5, 1), ...daily(5, 3000, 2011, 0, 1), ...daily(5, 4000, 2010, 11, 20)];
    const store = rig.sink;
    let walking = false;
    let armed = false;
    let killed = false;
    // The app dies at the first walk write after the walk, past its probe, meets a page the probe already landed.
    rig.sink = {
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
    assert.equal(rig.gather.storiesSoFar, rig.feed.length);
  });

  test('a signed-out answer mid-probe pauses the turn, and the next turn probes again', async () => {
    rig.feed = stories(40, 1000);
    rig.refuseFeed = (asked) => (asked === 1 ? signOut() : null);
    assert.equal((await turn()).outcome, 'paused');
    assert.equal(rig.gather.pausedReason, 'logged_out');
    const held = await rig.sink.readWalk();
    assert.equal(held?.probed, false);

    rig.refuseFeed = () => null;
    rig.probe = ok(FAN);
    rig.cursors = [];
    assert.equal((await turn()).outcome, 'done');
    assert.ok((rig.cursors[0] ?? Infinity) < held.olderThan, 'the first request is a probe below the cursor');
    assert.equal(await storyCount(), 40);
  });

  test('a Bandcamp error mid-probe fails the turn with its status, and the next turn searches on', async () => {
    rig.feed = stories(40, 1000);
    rig.refuseFeed = (asked) => (asked === 1 ? { kind: 'error', status: 429 } : null);
    const failed = await turn();
    assert.equal(failed.outcome, 'failed');
    assert.equal(failed.status, 429);
    assert.equal(rig.cursors.length, 2, 'nothing is asked after the refusal');
    const held = await rig.sink.readWalk();
    assert.equal(held?.probed, false);
    assert.equal(held.pagesDone, 0);

    rig.refuseFeed = () => null;
    assert.equal((await turn()).outcome, 'done');
    assert.equal(await storyCount(), 40);
  });

  test('a probe answer that does not arrive ends the probe and the walk still runs', async () => {
    rig.feed = stories(40, 1000);
    rig.refuseFeed = (asked) => (asked === 0 ? { kind: 'unreachable' } : null);
    assert.equal((await turn()).outcome, 'done');
    assert.equal(rig.cursors[1], START_S, "the walk's first page follows the failed probe");
    assert.equal(await storyCount(), 40);
  });

  test('a poll stored before the probe existed resumes, through a page already held', async () => {
    rig.feed = stories(20, 1000);
    await turn();
    // The shape a walk had before the depth probe, at the cursor the first walk's first page was asked with.
    const poll = { kind: 'feed_poll', fanId: FAN.fanId, username: FAN.username, olderThan: START_S, pagesDone: 0, dedupedRun: 0, maxPages: POLL_MAX_PAGES, poked: true, startedAt: START, sinceTs: rig.gather.newestStoryDate, newestSeen: null };
    await writeKv(rig.db, WALK_KEY, poll);
    rig.cursors = [];
    assert.equal((await turn(600_000, 'timer')).outcome, 'done');
    assert.deepEqual(rig.cursors, [START_S]);
    assert.equal(await rig.sink.readWalk(), null);
  });
});

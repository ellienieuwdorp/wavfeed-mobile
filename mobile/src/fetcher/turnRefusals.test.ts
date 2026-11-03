/// <reference types="node" />
/** Gather turns Bandcamp refuses or signs out: the identity probe, a failed feed page and a feed answer that looks signed out. */
import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';

import { rig, resetRig, PAGE_SIZE, FAN, OTHER_FAN, stories, ok, datedPage, turn, followBands, storyCount } from '../../test/gatherRig';
import { FEED_RETRY_AFTER_MS } from './turn';

beforeEach(resetRig);

describe('the probe', () => {
  test('a signed-out probe pauses as not connected before any Fan, and as logged out after one', async () => {
    rig.probe = { kind: 'logged_out' };
    assert.equal((await turn()).outcome, 'paused');
    assert.equal(rig.gather.pausedReason, 'not_connected');
    rig.probe = ok(FAN);
    await turn();
    rig.probe = { kind: 'logged_out' };
    assert.equal((await turn()).outcome, 'paused');
    assert.equal(rig.gather.pausedReason, 'logged_out');
    assert.equal(rig.gather.identity?.fanId, FAN.fanId);
  });

  test('a different Fan signed in pauses the store as signed out and files other_fan, not a store error', async () => {
    await turn();
    rig.probe = ok(OTHER_FAN);
    assert.equal((await turn()).outcome, 'paused');
    assert.equal(rig.gather.pausedReason, 'logged_out');
    assert.equal(rig.gather.lastError, 'other_fan');
    assert.equal(rig.gather.identity?.fanId, FAN.fanId);
    assert.equal(rig.gather.phase, 'idle');
  });

  test('a 429 on the probe is a Bandcamp error with its status, not a sign-out', async () => {
    await turn();
    rig.probe = { kind: 'error', status: 429 };
    assert.deepEqual(await turn(), { reason: 'open', outcome: 'failed', walkPending: false, status: 429, failedStep: 'probe', feedRetried: false });
    assert.equal(rig.gather.pausedReason, null);
    assert.equal(rig.gather.lastError, 'bandcamp_error');
    assert.equal(rig.gather.lastStatus, 429);
  });
});

describe('a feed page Bandcamp fails', () => {
  test('fails the turn with its status, and keeps the status beside the failure until a probe answers again', async () => {
    rig.feed = stories(3, 1000);
    rig.refuseFeed = () => ({ kind: 'error', status: 503 });
    assert.deepEqual(await turn(), { reason: 'open', outcome: 'failed', walkPending: true, status: 503, failedStep: 'depth_probe', feedRetried: false });
    assert.equal(rig.gather.lastError, 'bandcamp_error');
    assert.equal(rig.gather.lastStatus, 503);

    rig.refuseFeed = () => null;
    assert.equal((await turn(600_000, 'timer')).outcome, 'done');
    assert.equal(rig.gather.lastError, null);
    assert.equal(rig.gather.lastStatus, null);
  });

  test('with a 429 asks for no release page or band details after it (ADR-0017)', async () => {
    rig.feed = stories(3, 1000);
    rig.releasePage = () => ({ kind: 'error', status: 503 });
    await turn();
    await followBands([1, 2]);
    rig.bandDetails = ok({ kind: 'gone', status: 404 });
    rig.releasePage = datedPage;
    rig.releasePages = [];

    rig.clock += 15 * 60_000;
    rig.refuseFeed = () => ({ kind: 'error', status: 429 });
    const summary = await turn(600_000, 'timer');
    assert.equal(summary.outcome, 'failed');
    assert.equal(summary.status, 429);
    assert.deepEqual(rig.releasePages, []);
    assert.deepEqual(rig.bandDetailsAsked, []);

    rig.clock += 15 * 60_000;
    rig.refuseFeed = () => null;
    assert.equal((await turn(600_000, 'timer')).outcome, 'done');
    assert.equal(rig.releasePages.length, 3);
    assert.deepEqual(rig.bandDetailsAsked, [1, 2]);
  });

  test('unanswered fails the turn with no status', async () => {
    rig.refuseFeed = () => ({ kind: 'unreachable' });
    assert.deepEqual(await turn(), { reason: 'open', outcome: 'failed', walkPending: true, status: null, failedStep: 'feed_page', feedRetried: false });
    assert.equal(rig.gather.lastError, 'bandcamp_unreachable');
  });
});

describe('a feed answer that looks signed out', () => {
  /** A caught-up store whose next poll finds two new Stories. */
  async function caughtUp(): Promise<void> {
    rig.feed = stories(3, 1000);
    await turn();
    rig.clock += 15 * 60_000;
    rig.feed = [...stories(2, 2000, 60), ...rig.feed];
    rig.cursors = [];
    rig.probes = 0;
  }

  test('a 400 the probe calls signed in is asked again after the pause, and the poll lands', async () => {
    await caughtUp();
    const read = rig.gather.lastSuccessAt;
    rig.refuseFeed = (asked) => (asked === 0 ? { kind: 'error', status: 400 } : null);
    const before = rig.clock;
    const summary = await turn(600_000, 'refresh');
    assert.deepEqual([summary.outcome, summary.failedStep, summary.feedRetried], ['done', null, true]);
    assert.equal(rig.probes, 2, 'the turn probe and the recheck');
    assert.equal(rig.cursors[1], rig.cursors[0], 'the same page twice');
    assert.ok(rig.clock - before >= FEED_RETRY_AFTER_MS);
    assert.equal(await storyCount(), 5);
    assert.notEqual(rig.gather.lastSuccessAt, read);
  });

  test('a 400 the probe calls signed out pauses the turn as a sign-out', async () => {
    await caughtUp();
    rig.refuseFeed = (asked) => (asked === 0 ? (rig.probes > 1 ? null : ((rig.probe = { kind: 'logged_out' }), { kind: 'error', status: 400 })) : null);
    const summary = await turn(600_000, 'refresh');
    assert.deepEqual([summary.outcome, summary.feedRetried], ['paused', false]);
    assert.equal(rig.gather.pausedReason, 'logged_out');
    assert.equal(rig.cursors.length, 1, 'nothing is asked after the probe');
  });

  test('a body that is not JSON twice fails the turn as a Bandcamp error with no status, not a sign-out', async () => {
    await caughtUp();
    rig.refuseFeed = () => ({ kind: 'logged_out' });
    const summary = await turn(600_000, 'refresh');
    assert.deepEqual([summary.outcome, summary.status, summary.failedStep, summary.feedRetried], ['failed', 0, 'feed_page', true]);
    assert.equal(rig.gather.pausedReason, null);
    assert.equal(rig.gather.lastError, 'bandcamp_error');
    assert.equal(rig.cursors.length, 2);
  });

  test('a refusal asks neither the probe nor the page again (ADR-0017)', async () => {
    await caughtUp();
    rig.refuseFeed = () => ({ kind: 'error', status: 429 });
    const summary = await turn(600_000, 'refresh');
    assert.deepEqual([summary.outcome, summary.status, summary.feedRetried], ['failed', 429, false]);
    assert.equal(rig.probes, 1);
    assert.equal(rig.cursors.length, 1);
  });

  test('a turn rechecks once: a second suspect answer after a retry that landed fails it', async () => {
    // A first walk's depth probe: its second answer is retried as the third, and its fourth is not.
    rig.feed = stories(4 * PAGE_SIZE, 1000);
    rig.refuseFeed = (asked) => (asked === 1 || asked === 3 ? { kind: 'error', status: 400 } : null);
    const summary = await turn();
    assert.deepEqual([summary.outcome, summary.status, summary.failedStep, summary.feedRetried], ['failed', 400, 'depth_probe', true]);
    assert.equal(rig.probes, 2);
    assert.equal(rig.cursors.length, 4);
  });
});

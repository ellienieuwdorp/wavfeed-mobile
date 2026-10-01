/// <reference types="node" />
/** What a screen reader is told without moving its focus: the first walk's milestones and the notice line's lifetime (VIS-2). */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { copy } from '../copy';
import { EMPTY_GATHER_STATE, type GatherState } from '../fetcher/sink';
import { catchUpMilestone, NOTICE_LIFETIME_MS, noticeLifetime } from './spoken';

const FAN = { fanId: 2214537, username: 'fan' };
const running: GatherState = { ...EMPTY_GATHER_STATE, identity: FAN, phase: 'walking', storiesSoFar: 520 };

test('a running first walk is announced when it ends and when a sign-out pauses it', () => {
  assert.equal(catchUpMilestone(running, { ...running, initialWalkDone: true, phase: 'idle' }), copy.catchUp.finished);
  assert.equal(catchUpMilestone(running, { ...running, pausedReason: 'logged_out' }), copy.catchUp.paused);
  assert.equal(catchUpMilestone(running, { ...running, pausedReason: 'not_connected' }), copy.catchUp.paused);
});

test('count ticks, a store read at launch and steps after the walk say nothing', () => {
  assert.equal(catchUpMilestone(running, { ...running, storiesSoFar: 540, phase: 'idle' }), null);
  // The provider starts empty and then reads the store, which may hold a finished or a paused walk.
  assert.equal(catchUpMilestone(EMPTY_GATHER_STATE, { ...running, initialWalkDone: true }), null);
  assert.equal(catchUpMilestone(EMPTY_GATHER_STATE, { ...running, pausedReason: 'logged_out' }), null);
  const paused = { ...running, pausedReason: 'logged_out' as const };
  assert.equal(catchUpMilestone(paused, { ...paused, storiesSoFar: 600 }), null);
  const done = { ...running, initialWalkDone: true };
  assert.equal(catchUpMilestone(done, { ...done, pausedReason: 'logged_out' }), null);
  // Remove everything empties the store under a running walk.
  assert.equal(catchUpMilestone(running, EMPTY_GATHER_STATE), null);
});

test('a raised notice line stays until dismissed while a screen reader is on', () => {
  assert.equal(noticeLifetime(false), NOTICE_LIFETIME_MS);
  assert.equal(noticeLifetime(true), null);
});

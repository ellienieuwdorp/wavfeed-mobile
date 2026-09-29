/// <reference types="node" />
/**
 * The action Tallies' pure rules (task 0038): the doors into Connect, one ending per Connect visit, a Wishlist Action's
 * codes, a Release's listening from its first Track to its end or its replacement, and every catalogue row reached
 * from the app's own source.
 */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'node:test';

import {
  connectFrom,
  connectHref,
  failSignIn,
  finishSignIn,
  listenStep,
  openSignIn,
  playbackStarted,
  wishlistActionFinished,
  type Listening,
  type PlayerChange,
} from './actions';
import { CATALOGUE, TALLY_NAMES, type Tally, type TallyName } from './catalogue';

describe('the doors into Connect', () => {
  test('each door survives the route param, and anything else is no door', () => {
    for (const door of CATALOGUE.connect_opened.props.from) assert.equal(connectFrom(connectHref(door).params.from), door);
    for (const param of [undefined, '', 'Settings', 'first_run ', ['settings'], 3]) assert.equal(connectFrom(param), null);
  });
});

describe('one sign_in_finished per Connect visit', () => {
  const OPENED = 1_000_000;

  test('a sign-in ends the visit once, and the screen closing after it adds nothing', () => {
    const first = finishSignIn(openSignIn(OPENED, false), 'signed_in', OPENED + 12_000);
    assert.deepEqual(first.tally, { name: 'sign_in_finished', props: { outcome: 'signed_in', had_identity: false, wait: '10 to 60s' } });
    assert.equal(finishSignIn(first.visit, 'left', OPENED + 13_000).tally, null);
  });

  test('a visit left after failure lines reports the last one, and one left without any reports closed', () => {
    let visit = failSignIn(openSignIn(OPENED, true), 'unreachable');
    visit = failSignIn(visit, 'other_fan_refused');
    assert.deepEqual(finishSignIn(visit, 'left', OPENED + 500).tally?.props, { outcome: 'other_fan_refused', had_identity: true, wait: '<1s' });
    assert.equal(finishSignIn(openSignIn(OPENED, false), 'left', OPENED + 4_000).tally?.props.outcome, 'closed');
  });

  test('a failure after the visit ended changes nothing', () => {
    const { visit } = finishSignIn(openSignIn(OPENED, false), 'signed_in', OPENED);
    assert.equal(failSignIn(visit, 'page_failed'), visit);
  });
});

describe('wishlist_action_finished', () => {
  const wire = (end: 'ok' | 'already_there' | 'crumb_replays_spent', requests: number) => ({ end, requests });

  test('a taken write is done, or already there when Bandcamp said so, with its crumb replays bucketed', () => {
    assert.deepEqual(wishlistActionFinished({ action: 'add', surface: 'row', onTrack: false, failure: null, wire: wire('ok', 1) }).props, {
      action: 'add', result: 'done', failure: 'none', end: 'ok', target: 'release', surface: 'row', crumb_replays: '0',
    });
    const there = wishlistActionFinished({ action: 'add', surface: 'tracklist', onTrack: true, failure: null, wire: wire('already_there', 2) });
    assert.equal(there.props.result, 'already_there');
    assert.equal(there.props.target, 'track');
    assert.equal(there.props.crumb_replays, '1');
  });

  test('a refused write and a press that sent nothing are failed, with or without the wire', () => {
    const refused = wishlistActionFinished({ action: 'remove', surface: 'sheet', onTrack: true, failure: 'bandcamp_rejected', wire: wire('crumb_replays_spent', 4) });
    assert.deepEqual([refused.props.result, refused.props.failure, refused.props.end, refused.props.crumb_replays], ['failed', 'bandcamp_rejected', 'crumb_replays_spent', '2+']);
    const unsent = wishlistActionFinished({ action: 'add', surface: 'row_menu', onTrack: false, failure: 'not_signed_in', wire: null });
    assert.deepEqual([unsent.props.end, unsent.props.crumb_replays], ['none', '0']);
  });
});

test('playback_started buckets the wait and keeps the screen and the retry', () => {
  assert.deepEqual(playbackStarted('playing', 2_400, 'feed', false), {
    name: 'playback_started',
    props: { result: 'playing', wait: '1 to 3s', screen: 'feed', retried: false },
  });
});

describe('release_listened', () => {
  /** Runs changes at their times and collects the Tallies. */
  function run(changes: readonly [number, PlayerChange][]): Tally[] {
    let listening: Listening | null = null;
    const tallies: Tally[] = [];
    for (const [at, change] of changes) {
      const step = listenStep(listening, change, at);
      listening = step.listening;
      if (step.tally !== null) tallies.push(step.tally);
    }
    return tallies;
  }
  const A = 'album:1';
  const B = 'album:2';

  test('a Release played to its end is one Tally counting its Tracks and only the time it played', () => {
    const tallies = run([
      [0, { kind: 'load', release: A }],
      [1_000, { kind: 'start', release: A }],
      [61_000, { kind: 'playing', on: false }],
      [600_000, { kind: 'playing', on: true }],
      [660_000, { kind: 'start', release: A }],
      [720_000, { kind: 'start', release: A }],
      [780_000, { kind: 'end' }],
      [780_000, { kind: 'playing', on: false }],
    ]);
    assert.deepEqual(tallies, [{ name: 'release_listened', props: { tracks_started: '2 to 5', listened: '1 to 10m', reached_end: true } }]);
  });

  test('another Release replaces it, a reload of the same one continues it, and a load that never started counts nothing', () => {
    const tallies = run([
      [0, { kind: 'start', release: A }],
      [30_000, { kind: 'load', release: A }],
      [31_000, { kind: 'playing', on: false }],
      [33_000, { kind: 'start', release: A }],
      [40_000, { kind: 'load', release: B }],
      [41_000, { kind: 'load', release: A }],
    ]);
    assert.deepEqual(tallies, [{ name: 'release_listened', props: { tracks_started: '2 to 5', listened: '10 to 60s', reached_end: false } }]);
  });

  test('a start straight onto another Release ends the one before', () => {
    const tallies = run([
      [0, { kind: 'start', release: A }],
      [5_000, { kind: 'start', release: B }],
      [9_000, { kind: 'end' }],
    ]);
    assert.deepEqual(tallies.map((tally) => tally.props), [
      { tracks_started: '1', listened: '3 to 10s', reached_end: false },
      { tracks_started: '1', listened: '3 to 10s', reached_end: true },
    ]);
  });
});

/** Every `.ts` and `.tsx` file under `src` that is not a test, with its text. */
function sources(): { path: string; text: string }[] {
  const root = join(import.meta.dirname, '..');
  return readdirSync(root, { recursive: true, encoding: 'utf8' })
    .filter((file) => /\.tsx?$/.test(file) && !file.endsWith('.test.ts'))
    .map((file) => ({ path: file, text: readFileSync(join(root, file), 'utf8') }));
}

/** The pure builders that spell a name out for the app to call; the rest are spelled at their call site. */
const BUILDERS: Partial<Record<TallyName, string>> = {
  sign_in_finished: 'finishSignIn',
  sync_run_finished: 'gatherTallies',
  gather_finished: 'gatherTallies',
  projection_skipped: 'projectionSkipped',
  playback_started: 'playbackStarted',
  release_listened: 'listenStep',
  wishlist_action_finished: 'wishlistActionFinished',
  tallies_dropped: 'enqueueDropped',
};

test('every catalogue row is built somewhere in the app, and each pure builder is called outside the Tally core', () => {
  const files = sources();
  const core = new Set([join('tally', 'tally.ts'), join('tally', 'actions.ts'), join('tally', 'outbox.ts')]);
  for (const name of TALLY_NAMES) {
    const spelled = files.filter((file) => file.text.includes(`name: '${name}'`));
    assert.ok(spelled.length > 0, `${name} is never built`);
    const builder = BUILDERS[name];
    if (builder === undefined) {
      assert.ok(spelled.every((file) => !core.has(file.path)), `${name} is spelled in the core; name its builder`);
      continue;
    }
    const callers = files.filter((file) => !core.has(file.path) && new RegExp(`\\b${builder}\\(`).test(file.text));
    assert.ok(callers.length > 0, `${builder}, which builds ${name}, is never called`);
  }
});

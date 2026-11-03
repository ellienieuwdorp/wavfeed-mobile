/// <reference types="node" />
/**
 * The catalogue as a contract (ADR-0021): names in the house pattern, codes frozen so the Worker's stored
 * integers never change meaning, closed value sets, and a union that refuses free text at compile time.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { WishlistEnd } from '../bandcamp/wishlist';
import type { GatherFailure, PausedReason } from '../fetcher/sink';
import type { GatherReason, TurnOutcome } from '../fetcher/turn';
import { CATALOGUE, TALLY_NAMES, type Tally } from './catalogue';

test('every name is object_action in lower snake case', () => {
  for (const name of TALLY_NAMES) assert.match(name, /^[a-z]+(_[a-z]+)+$/);
});

test('codes are unique and never move: a retired code stays retired, a new row takes the next free one', () => {
  assert.deepEqual(Object.fromEntries(TALLY_NAMES.map((name) => [name, CATALOGUE[name].code])), {
    app_opened: 1,
    screen_viewed: 2,
    connect_opened: 3,
    sign_in_finished: 4,
    sync_run_finished: 5,
    gather_finished: 6,
    projection_skipped: 7,
    feed_refreshed: 8,
    playback_started: 9,
    release_listened: 10,
    playback_failed: 11,
    wishlist_action_finished: 12,
    release_opened_on_bandcamp: 13,
    signed_out: 14,
    store_removed: 15,
    notice_shown: 16,
    app_ended_unexpectedly: 17,
    tallies_dropped: 18,
  });
});

test('the Worker still takes every value an older bundle sends', () => {
  // Older bundles still send `row`, `mini_player`, the `bought` screens and a refresh from `bought`, none of which
  // this bundle draws.
  const sent: readonly (readonly [readonly string[], readonly string[]])[] = [
    [CATALOGUE.wishlist_action_finished.props.surface, ['row', 'row_menu', 'mini_player', 'sheet', 'tracklist']],
    [CATALOGUE.screen_viewed.props.screen, ['bought', 'bought_upcoming']],
    [CATALOGUE.feed_refreshed.props.from, ['feed', 'releases', 'bought']],
  ];
  for (const [values, released] of sent) for (const value of released) assert.ok(values.includes(value), value);
});

test('every property is a closed, non-empty set of distinct strings or booleans', () => {
  for (const name of TALLY_NAMES) {
    for (const [key, values] of Object.entries(CATALOGUE[name].props) as [string, readonly unknown[]][]) {
      assert.match(key, /^[a-z]+(_[a-z]+)*$/, `${name}.${key}`);
      assert.ok(values.length > 0, `${name}.${key}`);
      assert.equal(new Set(values).size, values.length, `${name}.${key}`);
      assert.ok(values.every((v) => typeof v === 'boolean' || typeof v === 'string'), `${name}.${key}`);
    }
  }
});

test('the Tally type takes only declared properties and values', () => {
  const fine: Tally[] = [
    { name: 'screen_viewed', props: { screen: 'feed' } },
    { name: 'store_removed', props: {} },
  ];
  // @ts-expect-error a title has no field to ride in
  const title: Tally = { name: 'screen_viewed', props: { screen: 'feed', title: 'Vortex Archives' } };
  // @ts-expect-error an exact count is not a bucket
  const exact: Tally = { name: 'tallies_dropped', props: { reason: 'full', dropped: '37' } };
  // @ts-expect-error a URL is not a screen
  const url: Tally = { name: 'screen_viewed', props: { screen: 'https://bandcamp.com/diggerfan' } };
  assert.equal([...fine, title, exact, url].length, 5);
});

type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type Values<N extends keyof typeof CATALOGUE, K extends string> = (typeof CATALOGUE)[N]['props'] extends Record<K, readonly (infer V)[]> ? V : never;

test('the lists spelled out in the catalogue match the app types they copy', () => {
  const pinned: [
    Same<Values<'wishlist_action_finished', 'end'>, WishlistEnd | 'none'>,
    Same<Values<'gather_finished', 'reason'>, GatherReason>,
    Same<Values<'gather_finished', 'outcome'>, TurnOutcome>,
    Same<Values<'gather_finished', 'paused'>, PausedReason | 'none'>,
    Same<Values<'gather_finished', 'failure'>, GatherFailure | 'none'>,
  ] = [true, true, true, true, true];
  assert.equal(pinned.length, 5);
});

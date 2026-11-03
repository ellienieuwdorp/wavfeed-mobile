/// <reference types="node" />
/**
 * Starting audio: a throw from the player's `play()` is a refused start, and a Track whose start was refused
 * lands loaded and paused at its index with the load's result `refused`.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { startAt, startAudio, type StartingPlayer } from './start';

/** A player that records what it was handed and, when `refuses`, throws from `play()` as iOS's session activation does. */
function player(refuses: boolean): StartingPlayer & { readonly calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    replace: (source) => void calls.push(`replace ${source.uri}`),
    play: () => {
      calls.push('play');
      if (refuses) throw new Error('UnexpectedException: Session activation failed');
    },
  };
}

const FROM = { status: 'loading', index: null, playing: false, expiresAt: 7 } as const;

test('a throw from play() answers that audio did not start, and a play that returns answers that it did', () => {
  assert.equal(startAudio(player(true)), false);
  assert.equal(startAudio(player(false)), true);
});

test('a refused start keeps the Track loaded and paused at its index, and the load names it refused', () => {
  const refusing = player(true);
  assert.deepEqual(startAt(refusing, FROM, 2, 'https://t4.bcbits.com/stream/a'), {
    next: { status: 'ready', index: 2, playing: false, expiresAt: 7 },
    result: 'refused',
  });
  assert.deepEqual(refusing.calls, ['replace https://t4.bcbits.com/stream/a', 'play']);
});

test('an accepted start plays, and sample mode plays the state without touching a player', () => {
  for (const at of [player(false), null]) {
    assert.deepEqual(startAt(at, FROM, 0, 'https://t4.bcbits.com/stream/b'), {
      next: { status: 'ready', index: 0, playing: true, expiresAt: 7 },
      result: 'playing',
    });
  }
});

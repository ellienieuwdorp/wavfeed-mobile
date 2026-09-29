/// <reference types="node" />
/** The first walk's progress as the catch-up strip reads it from the stored walk (task 0040). */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { WalkState } from '../fetcher/sink';
import { walkProgress } from './walkProgress';

const START_MS = Date.UTC(2026, 8, 25, 12, 0, 0);
const START = START_MS / 1000;
const YEAR = 365 * 24 * 60 * 60;

function walk(overrides: Partial<WalkState>): WalkState {
  return {
    kind: 'feed_walk',
    fanId: 1,
    username: 'diggerfan',
    olderThan: START,
    pagesDone: 0,
    dedupedRun: 0,
    maxPages: 400,
    poked: true,
    startedAt: START_MS,
    sinceTs: null,
    newestSeen: null,
    probed: true,
    floor: START - 10 * YEAR,
    probeOldest: [],
    ...overrides,
  };
}

test('the strip knows how far back the first walk has reached once a page lands, and fills towards the floor', () => {
  const cases: [string, WalkState | null, { reachedAt: number | null; fraction: number | null }][] = [
    ['no walk stored', null, { reachedAt: null, fraction: null }],
    ['a poll', walk({ kind: 'feed_poll', pagesDone: 3, olderThan: START - YEAR }), { reachedAt: null, fraction: null }],
    ['a first walk before its first page', walk({ pagesDone: 0 }), { reachedAt: null, fraction: null }],
    ['a first walk the probe gave no floor', walk({ pagesDone: 4, olderThan: START - YEAR, floor: null }), { reachedAt: START - YEAR, fraction: null }],
    ['a quarter of the way to the floor', walk({ pagesDone: 40, olderThan: START - 2.5 * YEAR }), { reachedAt: START - 2.5 * YEAR, fraction: 0.25 }],
    ['past the floor', walk({ pagesDone: 90, olderThan: START - 11 * YEAR }), { reachedAt: START - 11 * YEAR, fraction: 0.99 }],
    ['a floor at the start', walk({ pagesDone: 1, olderThan: START - 60, floor: START }), { reachedAt: START - 60, fraction: null }],
    ['a floor after the start', walk({ pagesDone: 1, olderThan: START - 60, floor: START + 60 }), { reachedAt: START - 60, fraction: null }],
  ];
  for (const [name, stored, expected] of cases) assert.deepEqual(walkProgress(stored), expected, name);
});

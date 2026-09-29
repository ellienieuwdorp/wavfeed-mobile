/// <reference types="node" />
/** The first walk's fill as the catch-up reads it from the stored walk and the count so far (task 0040, decision 5). */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { StorySample, WalkState } from '../fetcher/sink';
import { forwardOnly, walkProgress } from './walkProgress';

const DAY = 24 * 60 * 60;
const utc = (y: number, m: number, d: number) => Date.UTC(y, m, d) / 1000;

// The author's first walk as the simulator's store held it (task 0040, the amendment).
const STARTED_AT = 1790701174376;
const START = Math.floor(STARTED_AT / 1000);
const FLOOR = 1281827215;
const AT_520 = 1789013813;
const PROBE: StorySample[] = [
  { newest: utc(2026, 8, 20), oldest: utc(2026, 8, 19), count: 20 },
  { newest: utc(2017, 4, 20), oldest: utc(2017, 4, 16), count: 20 },
  { newest: utc(2012, 5, 1), oldest: utc(2012, 5, 1) - 293 * DAY, count: 20 },
  { newest: FLOOR, oldest: FLOOR, count: 1 },
];

/** Five pages of twenty Stories, each `daysEach` long, ending at `cursor`. */
function pagesTo(cursor: number, daysEach: number): StorySample[] {
  return Array.from({ length: 5 }, (_, i) => ({ newest: cursor + (5 - i) * daysEach * DAY, oldest: cursor + (4 - i) * daysEach * DAY, count: 20 }));
}

function walk(overrides: Partial<WalkState>): WalkState {
  return {
    kind: 'feed_walk',
    fanId: 1,
    username: 'diggerfan',
    olderThan: AT_520,
    pagesDone: 26,
    dedupedRun: 0,
    maxPages: 500,
    poked: true,
    startedAt: STARTED_AT,
    sinceTs: null,
    newestSeen: null,
    probed: true,
    floor: FLOOR,
    probeOldest: [],
    samples: PROBE,
    recent: pagesTo(AT_520, 0.75),
    ...overrides,
  };
}

const near = (actual: number | null, expected: number, name: string) =>
  assert.ok(actual !== null && Math.abs(actual - expected) < 0.005, `${name}: ${actual} is not near ${expected}`);

test("the author's walk fills by Stories, at 520 and at about 3,000, where a share of time stayed under 1 percent", () => {
  const timeShare = (START - AT_520) / (START - FLOOR);
  assert.ok(timeShare < 0.004);
  // Sixteen years of history hold more Stories than 500 pages carry, so the pages left bound what is still to come.
  near(walkProgress(walk({}), 520).fraction, 520 / (520 + 474 * 20), 'at 520');
  const june = utc(2026, 5, 15);
  const at3000 = walk({ olderThan: june, pagesDone: 150, recent: pagesTo(june, 0.8) });
  near(walkProgress(at3000, 3000).fraction, 3000 / (3000 + 350 * 20), 'at 3,000');
  assert.equal(walkProgress(at3000, 3000).reachedAt, june);
});

test('with room for every page, the estimate integrates the rate between the samples', () => {
  const roomy = walk({ maxPages: 100_000 });
  const fraction = walkProgress(roomy, 520).fraction;
  // About 46,000 Stories still to come: the rate grows from under 0.1 a day in 2012 to 5 in 2017 and 27 at the cursor.
  assert.ok(fraction !== null && fraction > 0.009 && fraction < 0.014, `fraction ${fraction}`);
  assert.ok(fraction > 3 * ((START - AT_520) / (START - FLOOR)), 'far ahead of the share of time');

  // A flat rate: 20 Stories a day, 100 days down to the floor, 2,000 still to come.
  const flat = [{ newest: AT_520 - 40 * DAY, oldest: AT_520 - 41 * DAY, count: 20 }];
  const even = walk({ maxPages: 100_000, floor: AT_520 - 100 * DAY, samples: flat, recent: pagesTo(AT_520, 1) });
  near(walkProgress(even, 2000).fraction, 0.5, 'a flat rate');
});

test('the fill has nothing to say, or says almost done, at the edges', () => {
  const cases: [string, WalkState | null, number, { reachedAt: number | null; fraction: number | null }][] = [
    ['no walk stored', null, 0, { reachedAt: null, fraction: null }],
    ['a poll', walk({ kind: 'feed_poll' }), 520, { reachedAt: null, fraction: null }],
    ['a first walk before its first page', walk({ pagesDone: 0 }), 0, { reachedAt: null, fraction: null }],
    ['no floor', walk({ floor: null }), 520, { reachedAt: AT_520, fraction: null }],
    ['a floor at the start', walk({ floor: START }), 520, { reachedAt: AT_520, fraction: null }],
    ['no sample at all', walk({ samples: undefined, recent: undefined }), 520, { reachedAt: AT_520, fraction: null }],
    ['only samples with no span', walk({ samples: [PROBE[3] as StorySample], recent: [] }), 520, { reachedAt: AT_520, fraction: null }],
    ['past the floor', walk({ olderThan: FLOOR - DAY }), 9000, { reachedAt: FLOOR - DAY, fraction: 0.99 }],
    ['at the page cap', walk({ pagesDone: 500 }), 10_000, { reachedAt: AT_520, fraction: 0.99 }],
  ];
  for (const [name, stored, soFar, expected] of cases) assert.deepEqual(walkProgress(stored, soFar), expected, name);

  // A page landed but its count was never written, as when a turn dies between the two: no count, no fill, never 0.99.
  const uncounted = walk({ pagesDone: 1, samples: [{ newest: utc(2015, 4, 20), oldest: utc(2015, 4, 10), count: 20 }], recent: pagesTo(AT_520, 0.75).slice(-1) });
  assert.deepEqual(walkProgress(uncounted, 0), { reachedAt: AT_520, fraction: null }, 'a page with no count yet');

  const probeOnly = walkProgress(walk({ recent: [] }), 520).fraction;
  const cursorOnly = walkProgress(walk({ samples: [] }), 520).fraction;
  assert.ok(probeOnly !== null && probeOnly > 0 && probeOnly < 0.99, 'the probe alone estimates');
  assert.ok(cursorOnly !== null && cursorOnly > 0 && cursorOnly < 0.99, "the walk's own pages alone estimate");
});

test('the fill never moves back for the same walk, and starts over for a new one', () => {
  assert.equal(forwardOnly(1, 0.3), 0.3);
  assert.equal(forwardOnly(1, 0.25), 0.3);
  assert.equal(forwardOnly(1, 0.4), 0.4);
  assert.equal(forwardOnly(2, 0.05), 0.05);
});

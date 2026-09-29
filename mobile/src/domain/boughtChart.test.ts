/// <reference types="node" />
/**
 * The Bought view's weekly chart: Releases followed Fans bought, filed under the GMT Monday of their release week and
 * ranked by distinct buyers (ADR-0011). The week has one answer wherever the phone is, so the week cases run under
 * clocks either side of GMT. Ported from server/apps/api/test/boughtChart.test.ts (task 0036).
 */
import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';

import { BASE_DATE, chain, minutesAfter, newReleaseRow, storyRow } from '../../test/rows';
import { BURST_MIN_STORIES } from './assemble';
import { buildBoughtChart, weekStartOf } from './boughtChart';

/** The last instant of a Sunday, the first of the Monday after it, and the Wednesday of that week. */
const SUNDAY = new Date('2026-08-16T23:59:59.999Z');
const MONDAY = new Date('2026-08-17T00:00:00.000Z');
const WEDNESDAY = new Date('2026-08-19T00:00:00.000Z');
const NEXT_MONDAY = new Date('2026-08-24T00:00:00.000Z');

const THIS_WEEK = '2026-08-17';
const LAST_WEEK = '2026-08-10';

/** A purchase by a named Fan, spelled once so the cases stay about the rules. */
function bought(input: { itemId: number; fanId: number; releaseDate?: Date | null; storyDate?: Date }) {
  return storyRow({
    itemId: input.itemId,
    fanId: input.fanId,
    fanUsername: `fan_${input.fanId}`,
    releaseDate: input.releaseDate ?? null,
    storyDate: input.storyDate ?? BASE_DATE,
  });
}

function firstWeekIds(rows: Parameters<typeof buildBoughtChart>[0]): string[] {
  return buildBoughtChart(rows)[0]?.entries.map((item) => item.itemId) ?? [];
}

describe('the release week', () => {
  const zone = process.env.TZ;
  after(() => {
    if (zone === undefined) delete process.env.TZ;
    else process.env.TZ = zone;
  });

  const cases: [string, Date, string][] = [
    ['a Sunday release belongs to the week that started the Monday before', SUNDAY, LAST_WEEK],
    ['a new week starts on Monday, at its first instant', MONDAY, THIS_WEEK],
    ['a midweek release belongs to that week', WEDNESDAY, THIS_WEEK],
    ['a week crosses a month backwards without inventing a day', new Date('2026-09-06T12:00:00.000Z'), '2026-08-31'],
  ];

  // Sydney is already on Monday at 23:59 GMT on Sunday; Honolulu is still on Sunday at 00:00 GMT on Monday.
  for (const clock of ['Australia/Sydney', 'Pacific/Honolulu']) {
    for (const [name, date, week] of cases) {
      test(`${name}, on a clock in ${clock}`, () => {
        process.env.TZ = clock;
        assert.equal(weekStartOf(date), week);
      });
    }
  }
});

describe('what charts', () => {
  test('keeps a Release with a release date and one buyer you follow', () => {
    const chart = buildBoughtChart([bought({ itemId: 5001, fanId: 101, releaseDate: WEDNESDAY })]);

    assert.deepEqual(
      chart.map((week) => [week.weekStart, week.entries.map((item) => item.itemId)]),
      [[THIS_WEEK, ['5001']]],
    );
    assert.deepEqual(chart[0]?.entries[0]?.buyers.map((fan) => fan.username), ['fan_101']);
  });

  test('drops a Release whose release date is not known yet, since it has no week to file under', () => {
    assert.deepEqual(buildBoughtChart([bought({ itemId: 5001, fanId: 101 })]), []);
  });

  test('drops a Release nobody you follow bought', () => {
    const rows = [
      newReleaseRow({ itemId: 5001, releaseDate: WEDNESDAY }),
      storyRow({ itemId: 5001, storyType: 'wishlist', fanId: 202, fanUsername: 'fan_202', releaseDate: WEDNESDAY }),
    ];

    assert.deepEqual(buildBoughtChart(rows), []);
  });

  test("counts a Release bought inside somebody's spree, because buyers are buyers", () => {
    const rows = chain({ count: BURST_MIN_STORIES, gapMinutes: 5, firstItemId: 6000, row: { releaseDate: WEDNESDAY } });

    // One buyer each, so the freshest purchase comes first.
    assert.deepEqual(firstWeekIds(rows), ['6004', '6003', '6002', '6001', '6000']);
  });
});

describe('the ranking', () => {
  test('puts the widest agreement first', () => {
    const rows = [
      bought({ itemId: 5001, fanId: 101, releaseDate: WEDNESDAY }),
      bought({ itemId: 5002, fanId: 101, releaseDate: WEDNESDAY }),
      bought({ itemId: 5002, fanId: 202, releaseDate: WEDNESDAY }),
      bought({ itemId: 5002, fanId: 303, releaseDate: WEDNESDAY }),
      bought({ itemId: 5003, fanId: 101, releaseDate: WEDNESDAY }),
      bought({ itemId: 5003, fanId: 202, releaseDate: WEDNESDAY }),
    ];

    assert.deepEqual(firstWeekIds(rows), ['5002', '5003', '5001']);
  });

  test('breaks a tie in buyers with the fresher purchase', () => {
    const rows = [
      bought({ itemId: 5001, fanId: 101, releaseDate: WEDNESDAY, storyDate: minutesAfter(-60) }),
      bought({ itemId: 5002, fanId: 202, releaseDate: WEDNESDAY, storyDate: minutesAfter(0) }),
    ];

    assert.deepEqual(firstWeekIds(rows), ['5002', '5001']);
  });

  test('breaks a total tie by Release, so the chart comes back in one order', () => {
    const rows = [
      bought({ itemId: 5002, fanId: 101, releaseDate: WEDNESDAY }),
      bought({ itemId: 5001, fanId: 202, releaseDate: WEDNESDAY }),
    ];

    assert.deepEqual(firstWeekIds(rows), ['5001', '5002']);
  });

  test('ranks on purchases only, so a wishlist cannot lift a record', () => {
    const rows = [
      bought({ itemId: 5001, fanId: 101, releaseDate: WEDNESDAY }),
      storyRow({ itemId: 5001, storyType: 'wishlist', fanId: 202, fanUsername: 'fan_202', releaseDate: WEDNESDAY }),
      bought({ itemId: 5002, fanId: 101, releaseDate: WEDNESDAY }),
      bought({ itemId: 5002, fanId: 303, releaseDate: WEDNESDAY }),
    ];

    assert.deepEqual(firstWeekIds(rows), ['5002', '5001']);
  });
});

test('sorts newest week first, a pre-order in its future week on top, and never emits an empty week', () => {
  const rows = [
    bought({ itemId: 5001, fanId: 101, releaseDate: WEDNESDAY }),
    bought({ itemId: 5002, fanId: 101, releaseDate: SUNDAY }),
    // Released after every Story held, so a pre-order: it files where it is going to land.
    bought({ itemId: 5003, fanId: 101, releaseDate: NEXT_MONDAY }),
    // Eight weeks back, so the weeks between are really empty.
    bought({ itemId: 5004, fanId: 101, releaseDate: new Date('2026-06-24T00:00:00.000Z') }),
  ];

  assert.deepEqual(
    buildBoughtChart(rows).map((week) => week.weekStart),
    ['2026-08-24', THIS_WEEK, LAST_WEEK, '2026-06-22'],
  );
});

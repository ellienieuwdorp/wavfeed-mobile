/// <reference types="node" />
/**
 * The Bought view's crossed mode: which Releases reached a buyer threshold, and when the threshold-th distinct followed
 * Fan's first purchase got them there, newest crossing first and release date ignored. Ported from
 * server/apps/api/test/boughtCrossed.test.ts (task 0036).
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { daysAfter, minutesAfter, newReleaseRow, storyRow } from '../../test/rows';
import type { ApiBoughtCrossedEntry } from './apiTypes';
import { buildCrossedList } from './boughtCrossed';

/** A purchase by a named Fan, spelled once so the cases stay about the rules. */
function bought(input: { itemId: number; fanId: number; storyDate: Date; itemType?: 'a' | 't' }) {
  return storyRow({
    itemId: input.itemId,
    itemType: input.itemType ?? 'a',
    fanId: input.fanId,
    fanUsername: `fan_${input.fanId}`,
    storyDate: input.storyDate,
  });
}

function keysOf(entries: readonly ApiBoughtCrossedEntry[]): string[] {
  return entries.map((entry) => `${entry.item.itemType}:${entry.item.itemId}`);
}

describe('what crosses, and when', () => {
  const rows = [
    bought({ itemId: 5001, fanId: 101, storyDate: daysAfter(0) }),
    bought({ itemId: 5001, fanId: 202, storyDate: daysAfter(1) }),
    bought({ itemId: 5001, fanId: 303, storyDate: daysAfter(30) }),
  ];
  const cases: [number, Date | null][] = [
    [2, daysAfter(1)],
    [3, daysAfter(30)],
    [4, null],
  ];

  for (const [threshold, crossedAt] of cases) {
    const outcome = crossedAt === null ? 'is one buyer short' : 'crosses at that buyer, not the latest';
    test(`a threshold of ${threshold} ${outcome}`, () => {
      assert.deepEqual(
        buildCrossedList(rows, threshold).map((entry) => entry.crossedAt),
        crossedAt === null ? [] : [crossedAt.toISOString()],
      );
    });
  }

  test('includes a Release whose release date is not known yet, where the weekly chart shows nothing', () => {
    const entries = buildCrossedList(
      [
        bought({ itemId: 5001, fanId: 101, storyDate: daysAfter(0) }),
        bought({ itemId: 5001, fanId: 202, storyDate: daysAfter(1) }),
      ],
      2,
    );

    assert.deepEqual(keysOf(entries), ['a:5001']);
    assert.equal(entries[0]?.item.releaseDate, null);
  });

  test('counts a Fan once, at their earliest purchase', () => {
    // Buying the same record again cannot move when it crossed, and one enthusiast cannot cross a threshold of two.
    const again = [
      bought({ itemId: 5001, fanId: 101, storyDate: daysAfter(0) }),
      bought({ itemId: 5001, fanId: 101, storyDate: daysAfter(9) }),
      bought({ itemId: 5001, fanId: 202, storyDate: daysAfter(2) }),
    ];

    assert.deepEqual(
      buildCrossedList(again, 2).map((entry) => entry.crossedAt),
      [daysAfter(2).toISOString()],
    );
    assert.deepEqual(buildCrossedList(again, 3), []);
  });

  test('reads each buyer\'s first purchase, whatever order the rows arrive in', () => {
    // Out of time order, fan_202's later purchase first: by Fan in arrival order, first purchases are days 1, 0, 30.
    const shuffled = [
      bought({ itemId: 5001, fanId: 202, storyDate: daysAfter(20) }),
      bought({ itemId: 5001, fanId: 101, storyDate: daysAfter(0) }),
      bought({ itemId: 5001, fanId: 303, storyDate: daysAfter(30) }),
      bought({ itemId: 5001, fanId: 202, storyDate: daysAfter(1) }),
    ];

    assert.equal(buildCrossedList(shuffled, 2)[0]?.crossedAt, daysAfter(1).toISOString());
  });

  test('counts purchases only, so a wishlist or a release cannot cross a record', () => {
    const others = [
      bought({ itemId: 5001, fanId: 101, storyDate: daysAfter(0) }),
      storyRow({ itemId: 5001, storyType: 'wishlist', fanId: 202, fanUsername: 'fan_202', storyDate: daysAfter(1) }),
      newReleaseRow({ itemId: 5001, storyDate: daysAfter(2) }),
    ];

    assert.deepEqual(buildCrossedList(others, 2), []);
  });

  test('ignores a purchase by a Fan it cannot name, as the buyers list does', () => {
    const anonymous = [
      bought({ itemId: 5001, fanId: 101, storyDate: daysAfter(0) }),
      storyRow({ itemId: 5001, fanId: null, fanUsername: null, storyDate: daysAfter(1) }),
    ];

    assert.deepEqual(buildCrossedList(anonymous, 2), []);
  });

  test('carries the whole Release, not just its purchases', () => {
    const entries = buildCrossedList(
      [
        newReleaseRow({ itemId: 5001, storyDate: daysAfter(0) }),
        bought({ itemId: 5001, fanId: 101, storyDate: daysAfter(1) }),
        bought({ itemId: 5001, fanId: 202, storyDate: daysAfter(2) }),
      ],
      2,
    );

    assert.equal(entries[0]?.item.hasNewRelease, true);
  });
});

describe('the ordering', () => {
  test('puts the newest crossing first, whenever the records came out', () => {
    const rows = [
      // A slow burner: first bought long ago, agreed on this week.
      bought({ itemId: 5001, fanId: 101, storyDate: daysAfter(-400) }),
      bought({ itemId: 5001, fanId: 202, storyDate: daysAfter(0) }),
      // Crossed a month back and has not moved since.
      bought({ itemId: 5002, fanId: 101, storyDate: daysAfter(-40) }),
      bought({ itemId: 5002, fanId: 202, storyDate: daysAfter(-30) }),
    ];

    assert.deepEqual(keysOf(buildCrossedList(rows, 2)), ['a:5001', 'a:5002']);
  });

  test('orders two crossings minutes apart on the same evening', () => {
    const rows = [
      bought({ itemId: 5001, fanId: 101, storyDate: minutesAfter(0) }),
      bought({ itemId: 5001, fanId: 202, storyDate: minutesAfter(5) }),
      bought({ itemId: 5002, fanId: 101, storyDate: minutesAfter(1) }),
      bought({ itemId: 5002, fanId: 202, storyDate: minutesAfter(9) }),
    ];

    assert.deepEqual(keysOf(buildCrossedList(rows, 2)), ['a:5002', 'a:5001']);
  });

  const ties: [string, [number, 'a' | 't'], [number, 'a' | 't']][] = [
    ['breaks a shared crossing moment by Release', [5002, 'a'], [5001, 'a']],
    ['tells an album from a track sharing its id', [5001, 't'], [5001, 'a']],
  ];

  for (const [name, first, second] of ties) {
    test(`${name}, so the list comes back in one order`, () => {
      const rows = [first, second].flatMap(([itemId, itemType]) => [
        bought({ itemId, itemType, fanId: 101, storyDate: daysAfter(0) }),
        bought({ itemId, itemType, fanId: 202, storyDate: daysAfter(1) }),
      ]);
      const expected = [second, first].map(([itemId, itemType]) => `${itemType}:${itemId}`);

      assert.deepEqual(keysOf(buildCrossedList(rows, 2)), expected);
    });
  }
});

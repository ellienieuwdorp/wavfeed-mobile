/// <reference types="node" />
/**
 * The Curated Feed's three modules (DESIGN-UI section 5). They do not follow the Browse rules: nothing collapses into a
 * Burst, and the window is measured from the newest Story held, not from the clock (task 0036).
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { BASE_DATE, chain, daysAfter, daysBefore, minutesAfter, newReleaseRow, storyRow } from '../../test/rows';
import { BURST_MIN_STORIES } from './assemble';
import { buildCurated, CURATED_NEW_MAX, CURATED_QUOTES_MAX, CURATED_WINDOW_DAYS } from './curate';
import type { FeedStoryRow } from './rows';

function boughtIds(rows: readonly FeedStoryRow[]): string[] {
  return buildCurated(rows).boughtByFollowed.map((item) => item.itemId);
}

function newIds(rows: readonly FeedStoryRow[]): string[] {
  return buildCurated(rows).newFromPages.map((item) => item.itemId);
}

describe('bought by people you follow', () => {
  const cases: [string, () => FeedStoryRow[], string[]][] = [
    [
      'keeps a Release two followed Fans bought inside the window',
      () => [storyRow({ itemId: 5001 }), storyRow({ itemId: 5001, fanId: 202, fanUsername: 'kessler_digs' })],
      ['5001'],
    ],
    [
      'does not count one Fan twice',
      () => [storyRow({ itemId: 5001 }), storyRow({ itemId: 5001, storyDate: minutesAfter(-30) })],
      [],
    ],
    [
      `ignores a purchase older than ${CURATED_WINDOW_DAYS} days`,
      () => [
        storyRow({ itemId: 5001 }),
        storyRow({
          itemId: 5001,
          fanId: 202,
          fanUsername: 'kessler_digs',
          storyDate: daysBefore(CURATED_WINDOW_DAYS + 1),
        }),
      ],
      [],
    ],
  ];

  for (const [name, rows, expected] of cases) {
    test(name, () => {
      assert.deepEqual(boughtIds(rows()), expected);
    });
  }

  test('wires only the windowed buyers, so the count and the avatars match the sentence', () => {
    const rows = [
      storyRow({ itemId: 5001, fanId: 101, fanUsername: 'a', storyDate: minutesAfter(-30) }),
      storyRow({ itemId: 5001, fanId: 202, fanUsername: 'b', storyDate: BASE_DATE }),
      // Newer than either purchase, and not a purchase: the module's time phrase is about buying.
      storyRow({ itemId: 5001, storyType: 'wishlist', fanId: 505, fanUsername: 'e', storyDate: minutesAfter(60) }),
      storyRow({ itemId: 5001, fanId: 303, fanUsername: 'c', storyDate: daysBefore(CURATED_WINDOW_DAYS + 1) }),
      storyRow({ itemId: 5001, fanId: 404, fanUsername: 'd', storyDate: daysBefore(CURATED_WINDOW_DAYS + 40) }),
    ];

    const [item] = buildCurated(rows).boughtByFollowed;

    // "2 people you follow bought this in the past two weeks": two avatars, and the newer of their purchases.
    assert.deepEqual(item?.buyers.map((fan) => fan.username), ['b', 'a']);
    assert.equal(item?.latestStoryDate, BASE_DATE.toISOString());
  });

  test('counts a spree buyer like anyone else: this module does not collapse', () => {
    const rows = [
      ...chain({ count: BURST_MIN_STORIES, gapMinutes: 5, firstItemId: 6000 }),
      storyRow({ itemId: 6000, fanId: 202, fanUsername: 'kessler_digs' }),
    ];

    assert.deepEqual(boughtIds(rows), ['6000']);
  });

  test('ranks the widest agreement first, then the freshest', () => {
    const pair = (itemId: number, storyDate: Date) => [
      storyRow({ itemId, storyDate }),
      storyRow({ itemId, fanId: 202, fanUsername: 'b', storyDate }),
    ];
    // The widest is the stalest, and the fresher of the two pairs has the higher id, so each rule shows.
    const rows = [
      ...pair(5001, minutesAfter(-10)),
      ...pair(5002, minutesAfter(0)),
      ...pair(5003, minutesAfter(-60)),
      storyRow({ itemId: 5003, fanId: 303, fanUsername: 'c', storyDate: minutesAfter(-60) }),
    ];

    assert.deepEqual(boughtIds(rows), ['5003', '5002', '5001']);
  });
});

describe('new from pages you follow', () => {
  test('orders by when a Release was announced, whatever its release date says', () => {
    const rows = [
      newReleaseRow({ itemId: 5001, releaseDate: daysBefore(1), storyDate: daysBefore(9) }),
      newReleaseRow({ itemId: 5002, releaseDate: daysBefore(5), storyDate: BASE_DATE }),
      newReleaseRow({ itemId: 5003, storyDate: daysBefore(3) }),
      storyRow({ itemId: 5004 }),
    ];

    assert.deepEqual(newIds(rows), ['5002', '5003', '5001']);
  });

  test(`does not let pre-orders dated into the future hold all ${CURATED_NEW_MAX} covers`, () => {
    // What production showed: pre-orders announced weeks ago with release dates months out, and today's release sixth.
    const preorders = Array.from({ length: CURATED_NEW_MAX }, (_, index) =>
      newReleaseRow({ itemId: 5300 + index, storyDate: daysBefore(21 + index), releaseDate: daysAfter(30 + index) }),
    );
    const outToday = newReleaseRow({ itemId: 5400, storyDate: BASE_DATE, releaseDate: BASE_DATE });

    const order = newIds([...preorders, outToday]);

    assert.equal(order[0], '5400');
    assert.equal(order.length, CURATED_NEW_MAX);
  });

  test('breaks a tie between two announcements made at once by Release', () => {
    const rows = [
      newReleaseRow({ itemId: 5002, storyDate: BASE_DATE }),
      newReleaseRow({ itemId: 5001, storyDate: BASE_DATE }),
    ];

    assert.deepEqual(newIds(rows), ['5001', '5002']);
  });
});

describe('in their own words', () => {
  test('quotes the newest purchases that came with review text, dated by the purchase', () => {
    const rows = [
      storyRow({
        itemId: 5003,
        reviewText: 'the b-side is the one',
        storyDate: minutesAfter(0),
        fanId: 202,
        fanUsername: 'kessler_digs',
      }),
      storyRow({
        itemId: 5001,
        reviewText: 'album of the year',
        storyDate: minutesAfter(10),
        releaseDate: daysBefore(400),
      }),
      storyRow({ itemId: 5002, storyDate: minutesAfter(20) }),
    ];

    const quotes = buildCurated(rows).inTheirOwnWords;

    assert.deepEqual(
      quotes.map((quote) => [quote.fan.username, quote.text, quote.date]),
      [
        ['dj_okonkwo', 'album of the year', minutesAfter(10).toISOString()],
        ['kessler_digs', 'the b-side is the one', minutesAfter(0).toISOString()],
      ],
    );
    assert.deepEqual(quotes[0]?.item, {
      itemType: 'a',
      itemId: '5001',
      title: 'Slow Harbour',
      pageName: 'Nightgraft',
      artistCredit: 'Nightgraft',
      artId: '1204871',
      itemUrl: 'https://nightgraft.bandcamp.com/album/slow-harbour',
    });
  });

  test("prints one Fan's words about one Release once", () => {
    const rows = [
      storyRow({ itemId: 5001, reviewText: 'album of the year', storyDate: minutesAfter(10) }),
      storyRow({ itemId: 5001, reviewText: 'album of the year', storyDate: minutesAfter(0) }),
    ];

    assert.equal(buildCurated(rows).inTheirOwnWords.length, 1);
  });

  test('never quotes a new_release, which nobody wrote', () => {
    assert.equal(buildCurated([newReleaseRow({ reviewText: "not a Fan's words" })]).inTheirOwnWords.length, 0);
  });

  test(`stops at ${CURATED_QUOTES_MAX} quotes`, () => {
    const rows = Array.from({ length: CURATED_QUOTES_MAX + 2 }, (_, index) =>
      storyRow({ itemId: 5200 + index, reviewText: `note ${index}`, storyDate: minutesAfter(index) }),
    );

    assert.equal(buildCurated(rows).inTheirOwnWords.length, CURATED_QUOTES_MAX);
  });
});

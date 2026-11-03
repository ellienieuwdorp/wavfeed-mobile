/// <reference types="node" />
/**
 * The de-noise rules the feed is judged by (ADR-0005), with anchor dates (ADR-0011): Stories fold into one Feed Item
 * per Release, a Fan's run of Stories collapses into a Burst, the type filter runs before both, and the chips count the
 * collection. The cases that matter are the boundaries: a chain exactly long enough, a gap exactly wide enough, a
 * Release that a spree touched but does not own.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { BASE_DATE, chain, minutesAfter, newReleaseRow, storyRow } from '../../test/rows';
import type { ApiBurst, ApiFeedElement, ApiFeedItem } from './apiTypes';
import { ALL_STORY_TYPES, assembleFeed, BURST_MAX_GAP_MINUTES, BURST_MIN_STORIES } from './assemble';
import type { FeedStoryRow } from './rows';

function assemble(rows: readonly FeedStoryRow[], overrides: Partial<Parameters<typeof assembleFeed>[1]> = {}) {
  return assembleFeed(rows, { types: ALL_STORY_TYPES, sort: 'activity', ...overrides });
}

function items(elements: readonly ApiFeedElement[]): ApiFeedItem[] {
  return elements.filter((element): element is ApiFeedItem => element.kind === 'item');
}

function bursts(elements: readonly ApiFeedElement[]): ApiBurst[] {
  return elements.filter((element): element is ApiBurst => element.kind === 'burst');
}

function ids(elements: readonly ApiFeedElement[]): string[] {
  return items(elements).map((item) => item.itemId);
}

describe('aggregation', () => {
  test('folds every Story about one Release into a single Feed Item with the Release on it', () => {
    const rows = [
      storyRow({ storyDate: minutesAfter(30), fanId: 202, fanUsername: 'kessler_digs', fanImageId: null }),
      storyRow({ storyDate: BASE_DATE }),
      newReleaseRow({ storyDate: minutesAfter(-60) }),
    ];

    const found = items(assemble(rows).elements);

    assert.equal(found.length, 1);
    const [item] = found;
    assert.deepEqual(
      [item?.itemId, item?.bandId, item?.artId, item?.featuredTrackId, item?.title, item?.pageName, item?.hasNewRelease],
      ['5001', '900', '1204871', '55501122', 'Slow Harbour', 'Nightgraft', true],
    );
    assert.deepEqual(
      item?.buyers.map((fan) => [fan.username, fan.fanId, fan.imageId]),
      [
        ['kessler_digs', '202', null],
        ['dj_okonkwo', '101', '88123456'],
      ],
    );
  });

  test('names each Fan once, ranked by their most recent Story', () => {
    const rows = [
      storyRow({ storyDate: minutesAfter(10) }),
      storyRow({ storyDate: minutesAfter(20), fanId: 202, fanUsername: 'kessler_digs' }),
      storyRow({ storyDate: minutesAfter(30) }),
    ];

    const [item] = items(assemble(rows).elements);

    assert.deepEqual(item?.buyers.map((fan) => fan.username), ['dj_okonkwo', 'kessler_digs']);
  });

  test('lets one Fan be both a buyer and a wishlister, because they were both', () => {
    const rows = [
      storyRow({ storyDate: minutesAfter(10) }),
      storyRow({ storyType: 'wishlist', storyDate: minutesAfter(-10) }),
    ];

    const [item] = items(assemble(rows).elements);

    assert.deepEqual(item?.buyers.map((fan) => fan.username), ['dj_okonkwo']);
    assert.deepEqual(item.wishlisters.map((fan) => fan.username), ['dj_okonkwo']);
  });

  test('collects review text newest first, with the Fan who wrote it', () => {
    const rows = [
      storyRow({ storyDate: minutesAfter(10), reviewText: 'album of the year' }),
      storyRow({
        storyDate: minutesAfter(-10),
        fanId: 202,
        fanUsername: 'kessler_digs',
        reviewText: 'the b-side is the one',
      }),
      storyRow({ storyDate: minutesAfter(-20), fanId: 303, fanUsername: 'quiet_hours' }),
    ];

    const [item] = items(assemble(rows).elements);

    assert.deepEqual(
      item?.reviews.map((review) => [review.fan.username, review.text]),
      [
        ['dj_okonkwo', 'album of the year'],
        ['kessler_digs', 'the b-side is the one'],
      ],
    );
  });
});

describe('anchor dates (ADR-0011)', () => {
  const releaseDate = new Date('2026-08-14T00:00:00.000Z');
  const cases: { name: string; rows: () => FeedStoryRow[]; anchor: Date; latest: Date }[] = [
    {
      name: 'a lone Story sits where it happened, even once its release date is known',
      rows: () => [storyRow({ storyDate: BASE_DATE, releaseDate })],
      anchor: BASE_DATE,
      latest: BASE_DATE,
    },
    {
      name: 'an aggregate anchors at the release date, so the spine stops churning',
      rows: () => [
        storyRow({ storyDate: minutesAfter(60), releaseDate }),
        storyRow({ storyDate: BASE_DATE, releaseDate, fanId: 202, fanUsername: 'kessler_digs' }),
      ],
      anchor: releaseDate,
      latest: minutesAfter(60),
    },
    {
      name: 'an aggregate falls back to its oldest Story when no release date has been learned',
      rows: () => [
        storyRow({ storyDate: minutesAfter(60) }),
        storyRow({ storyDate: BASE_DATE, fanId: 202, fanUsername: 'kessler_digs' }),
      ],
      anchor: BASE_DATE,
      latest: minutesAfter(60),
    },
  ];

  for (const { name, rows, anchor, latest } of cases) {
    test(name, () => {
      const [item] = items(assemble(rows()).elements);

      assert.equal(item?.anchorDate, anchor.toISOString());
      assert.equal(item.latestStoryDate, latest.toISOString());
    });
  }
});

describe('Bursts', () => {
  const thresholds = [
    {
      name: `a run of exactly ${BURST_MIN_STORIES} Stories collapses`,
      count: BURST_MIN_STORIES,
      gap: 10,
      collapsed: true,
    },
    { name: 'one Story short stays ordinary Feed Items', count: BURST_MIN_STORIES - 1, gap: 10, collapsed: false },
    {
      name: `a gap of exactly ${BURST_MAX_GAP_MINUTES} minutes still joins`,
      count: BURST_MIN_STORIES,
      gap: BURST_MAX_GAP_MINUTES,
      collapsed: true,
    },
    {
      name: 'one minute past the gap breaks the chain',
      count: BURST_MIN_STORIES,
      gap: BURST_MAX_GAP_MINUTES + 1,
      collapsed: false,
    },
  ];

  for (const { name, count, gap, collapsed } of thresholds) {
    test(name, () => {
      const { elements } = assemble(chain({ count, gapMinutes: gap }));

      assert.equal(bursts(elements).length, collapsed ? 1 : 0);
      assert.equal(items(elements).length, collapsed ? 0 : count);
    });
  }

  test('names the Fan, the Story type and every Story it holds', () => {
    const [burst] = bursts(assemble(chain({ count: BURST_MIN_STORIES, gapMinutes: 10 })).elements);

    assert.equal(burst?.storyCount, BURST_MIN_STORIES);
    assert.equal(burst.fan.username, 'dj_okonkwo');
    assert.equal(burst.storyType, 'purchase');
    assert.equal(burst.items.length, BURST_MIN_STORIES);
  });

  test('keeps the long half of a run that pauses in the middle', () => {
    const early = chain({ count: 2, gapMinutes: 5, firstItemId: 6100 });
    const late = chain({ count: BURST_MIN_STORIES, gapMinutes: 5, start: minutesAfter(600), firstItemId: 6200 });

    const { elements } = assemble([...early, ...late]);

    assert.deepEqual(
      bursts(elements).map((burst) => burst.storyCount),
      [BURST_MIN_STORIES],
    );
    assert.deepEqual(ids(elements).sort(), ['6100', '6101']);
  });

  test('chains per Fan, so two sprees interleaved in time stay two Bursts', () => {
    const mine = chain({ count: BURST_MIN_STORIES, gapMinutes: 10, firstItemId: 6100 });
    const theirs = chain({
      count: BURST_MIN_STORIES,
      gapMinutes: 10,
      start: minutesAfter(5),
      firstItemId: 6200,
      row: { fanId: 202, fanUsername: 'kessler_digs' },
    });

    const found = bursts(assemble([...mine, ...theirs]).elements);

    assert.deepEqual(found.map((burst) => burst.fan.username).sort(), ['dj_okonkwo', 'kessler_digs']);
  });

  test('calls a run of purchases and wishlists mixed', () => {
    const rows = chain({ count: BURST_MIN_STORIES, gapMinutes: 10 });
    const [head] = rows;
    assert.ok(head);
    rows[0] = { ...head, storyType: 'wishlist' };

    assert.equal(bursts(assemble(rows).elements)[0]?.storyType, 'mixed');
  });

  test('never chains a new_release, which no Fan acted on', () => {
    const rows = [
      ...chain({ count: BURST_MIN_STORIES - 1, gapMinutes: 5 }),
      newReleaseRow({ storyDate: minutesAfter(25), itemId: 6900 }),
    ];

    assert.equal(bursts(assemble(rows).elements).length, 0);
  });

  test('lists each Release once behind the chevron, however often it was touched', () => {
    const rows = chain({ count: BURST_MIN_STORIES, gapMinutes: 5 });
    rows.push(storyRow({ storyType: 'wishlist', storyDate: minutesAfter(2), itemId: 6000 }));

    const [burst] = bursts(assemble(rows).elements);

    assert.equal(burst?.storyCount, BURST_MIN_STORIES + 1);
    assert.equal(burst.items.length, BURST_MIN_STORIES);
  });

  test('still shows a Release the spree touched when another Fan acted on it too', () => {
    const rows = [
      ...chain({ count: BURST_MIN_STORIES, gapMinutes: 5 }),
      storyRow({ itemId: 6000, storyDate: minutesAfter(500), fanId: 202, fanUsername: 'kessler_digs' }),
    ];

    const { elements } = assemble(rows);
    const found = items(elements);

    assert.equal(bursts(elements).length, 1);
    assert.deepEqual(
      found.map((item) => item.itemId),
      ['6000'],
    );
    // Only the Fan who was not in the spree: the other Story is spoken for.
    assert.deepEqual(found[0]?.buyers.map((fan) => fan.username), ['kessler_digs']);
  });

  test('anchors a Burst where it ended, on either sort', () => {
    const last = minutesAfter(10 * (BURST_MIN_STORIES - 1)).toISOString();

    const [burst] = bursts(assemble(chain({ count: BURST_MIN_STORIES, gapMinutes: 10 })).elements);

    assert.equal(burst?.latestStoryDate, last);
    assert.equal(burst.anchorDate, last);
  });
});

describe('the type filter', () => {
  test('removes Stories before anything is grouped, so a filtered type adds nothing', () => {
    const rows = [
      storyRow({ storyDate: minutesAfter(10) }),
      storyRow({ storyType: 'wishlist', storyDate: BASE_DATE, fanId: 202, fanUsername: 'kess' }),
    ];

    const [item] = items(assemble(rows, { types: ['purchase'] }).elements);

    assert.equal(item?.wishlisters.length, 0);
    assert.equal(item.buyers.length, 1);
  });

  test('can dissolve a Burst, because four purchases are not a spree', () => {
    const rows = chain({ count: BURST_MIN_STORIES, gapMinutes: 5 });
    const [head] = rows;
    assert.ok(head);
    rows[0] = { ...head, storyType: 'wishlist' };

    const { elements } = assemble(rows, { types: ['purchase'] });

    assert.equal(bursts(elements).length, 0);
    assert.equal(items(elements).length, BURST_MIN_STORIES - 1);
  });

  test('shows nothing at all when every chip is unticked', () => {
    assert.equal(assemble([storyRow()], { types: [] }).elements.length, 0);
  });
});

describe('chip counts', () => {
  test('counts distinct Releases per type, blind to the type filter', () => {
    const rows = [
      storyRow({ itemId: 5001 }),
      storyRow({ itemId: 5001, storyDate: minutesAfter(1), fanId: 202, fanUsername: 'kess' }),
      storyRow({ itemId: 5001, storyType: 'wishlist', storyDate: minutesAfter(1) }),
      newReleaseRow({ itemId: 5002, storyDate: minutesAfter(2) }),
    ];

    assert.deepEqual(assemble(rows, { types: ['purchase'] }).typeCounts, { purchase: 1, wishlist: 1, new_release: 1 });
  });

  test('counts Burst members too: the chips describe the collection, not the collapse', () => {
    const rows = chain({ count: BURST_MIN_STORIES, gapMinutes: 5 });

    assert.equal(assemble(rows).typeCounts.purchase, BURST_MIN_STORIES);
  });
});

describe('sorting', () => {
  test('puts the most recent activity on top by default', () => {
    const rows = [
      storyRow({ itemId: 5001, storyDate: minutesAfter(0) }),
      storyRow({ itemId: 5002, storyDate: minutesAfter(30) }),
      storyRow({ itemId: 5003, storyDate: minutesAfter(-30) }),
    ];

    assert.deepEqual(ids(assemble(rows).elements), ['5002', '5001', '5003']);
  });

  test('puts an old record back where it belongs on the anchor sort', () => {
    const releaseDate = new Date('2026-06-01T00:00:00.000Z');
    const rows = [
      // Two Stories, so it anchors at the release date and not at either Story.
      storyRow({ itemId: 5001, storyDate: minutesAfter(30), releaseDate }),
      storyRow({ itemId: 5001, storyDate: minutesAfter(20), releaseDate, fanId: 202, fanUsername: 'kessler_digs' }),
      storyRow({ itemId: 5002, storyDate: minutesAfter(0) }),
    ];

    assert.deepEqual(ids(assemble(rows, { sort: 'activity' }).elements), ['5001', '5002']);
    assert.deepEqual(ids(assemble(rows, { sort: 'anchor' }).elements), ['5002', '5001']);
  });

  test('breaks a tie on identity, so the same rows always come back in one order', () => {
    const rows = [storyRow({ itemId: 5002, storyDate: BASE_DATE }), storyRow({ itemId: 5001, storyDate: BASE_DATE })];

    assert.deepEqual(ids(assemble(rows).elements), ['5001', '5002']);
    assert.deepEqual(ids(assemble([...rows].reverse()).elements), ['5001', '5002']);
  });
});

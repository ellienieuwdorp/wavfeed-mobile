/// <reference types="node" />
/**
 * The store's view reads narrow the wide Story join in SQL; each must answer what the server's feed rules answer on
 * the full join (task 0036, decision 3), and a rebuild from the Raw Documents must answer the same again (ADR-0004).
 * Bought is read once and placed per mode on every switch, so that placing answers the rules at each threshold too.
 * The wishlist crumb's stand-in, a Release the store holds on a bandcamp.com host, is picked here as well.
 */
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import type { SQLiteDatabase } from 'expo-sqlite';

import { DAY, enterHistory, makeHistory, oracleRows } from '../../test/history';
import { openTestStore } from '../../test/nodeDb';
import { assembleFeed, itemKey } from '../domain/assemble';
import { buildBoughtChart } from '../domain/boughtChart';
import { buildCrossedList, CROSSED_MAX_THRESHOLD, CROSSED_MIN_THRESHOLD } from '../domain/boughtCrossed';
import { buildCurated } from '../domain/curate';
import { buildNewReleases } from '../domain/newReleases';
import type { FeedStoryRow } from '../domain/rows';
import { buildUpcoming } from '../domain/upcoming';
import { fold, rebuild } from './projection';
import {
  boughtView,
  listUpcomingReleases,
  readBoughtReleases,
  readCurated,
  readNewestBandcampReleaseUrl,
  readNewReleases,
} from './queries';
import { insertRawDocument } from './rawDocuments';

const NOW = new Date(Date.UTC(2026, 8, 25, 12, 0, 0));
const SIZE = { pages: 100, releases: 800, fans: 120, purchases: 1600, wishes: 500 };

async function newReleasesByRules(db: SQLiteDatabase, rows: readonly FeedStoryRow[], now: Date) {
  const { elements } = assembleFeed(rows, { types: ['new_release'], sort: 'anchor' });
  const upcoming = await listUpcomingReleases(db, now);
  const wanted = new Set(upcoming.map(itemKey));
  return buildNewReleases(elements, buildUpcoming(upcoming, rows.filter((row) => wanted.has(itemKey(row)))), now);
}

test('an empty store answers every view as the rules answer no Stories', async () => {
  const { db, close } = await openTestStore();
  assert.deepEqual(await readCurated(db), buildCurated([]));
  assert.deepEqual(boughtView(await readBoughtReleases(db), { mode: 'released' }), { weeks: buildBoughtChart([]), nextCursor: null });
  assert.deepEqual(await readNewReleases(db, { now: NOW }), buildNewReleases([], [], NOW));
  close();
});

test("the wishlist crumb's stand-in is the newest Story's Release on a bandcamp.com host", async () => {
  const { db, close } = await openTestStore();
  assert.equal(await readNewestBandcampReleaseUrl(db), null);
  const held: readonly (readonly [number, string, string | null])[] = [
    [1, 'https://quietharbor.bandcamp.com/album/tidewater', '2026-09-01T00:00:00.000Z'],
    [2, 'https://lowtidesound.bandcamp.com/album/salt-flats', '2026-09-10T00:00:00.000Z'],
    [3, 'https://music.lowtidesound.com/album/shoals', '2026-09-20T00:00:00.000Z'],
    [4, 'https://decoy.example/x.bandcamp.com/album/lure', '2026-09-21T00:00:00.000Z'],
    [6, 'http://plain.bandcamp.com/album/unsealed', '2026-09-22T00:00:00.000Z'],
    [7, 'https://evil.example?.bandcamp.com/album/query', '2026-09-23T00:00:00.000Z'],
    [5, 'https://harbourlights.bandcamp.com/album/no-story', null],
  ];
  for (const [id, url, storyDate] of held) {
    await db.runAsync(
      `insert into releases (item_type, item_id, band_id, title, url, first_seen_at, last_seen_at)
       values ('a', ?, 1, 'Release', ?, '2026-09-01', '2026-09-01')`,
      [id, url],
    );
    if (storyDate === null) continue;
    await db.runAsync(
      `insert into stories (story_type, fan_key, item_type, item_id, story_date, raw_document_id)
       values ('new_release', 0, 'a', ?, ?, 1)`,
      [id, storyDate],
    );
  }
  assert.equal(await readNewestBandcampReleaseUrl(db), 'https://lowtidesound.bandcamp.com/album/salt-flats');
  close();
});

describe('over a long history', () => {
  let db: SQLiteDatabase;
  let close: () => void;
  let rows: FeedStoryRow[];
  let later: Awaited<ReturnType<typeof enterHistory>>;

  before(async () => {
    ({ db, close } = await openTestStore());
    later = await enterHistory(db, makeHistory(SIZE, NOW), NOW, 100);
    await fold(db);
    rows = await oracleRows(db);
  });
  after(() => close());

  test('New releases match the rules, today and 200 days back', async () => {
    const today = await readNewReleases(db, { now: NOW });
    assert.ok(today.weeks.length > 0 && today.upcoming.length > 0, 'the history reaches both halves of the view');
    assert.deepEqual(today, await newReleasesByRules(db, rows, NOW));
    const earlier = new Date(NOW.getTime() - 200 * DAY);
    assert.deepEqual(await readNewReleases(db, { now: earlier }), await newReleasesByRules(db, rows, earlier));
  });

  test('one Bought read places each mode and every threshold as the rules do', async () => {
    const held = await readBoughtReleases(db);
    const typeOf = new Map(held.map(({ item }) => [item.itemId, item.itemType]));
    assert.ok(held.some(({ item }) => typeOf.get(item.itemId) !== item.itemType), 'an album and a track share an id');
    const released = { weeks: buildBoughtChart(rows), nextCursor: null };
    assert.deepEqual(boughtView(held, { mode: 'released' }), released);
    let fewer = Infinity;
    for (let threshold = CROSSED_MIN_THRESHOLD; threshold <= CROSSED_MAX_THRESHOLD; threshold += 1) {
      const crossed = { entries: buildCrossedList(rows, threshold), nextCursor: null };
      const count = crossed.entries.length;
      assert.ok(count > 0 && count < fewer, `some Release crosses ${threshold}, fewer than one less`);
      fewer = count;
      assert.deepEqual(boughtView(held, { mode: 'crossed', threshold }), crossed);
    }
    const clamped = [
      [CROSSED_MIN_THRESHOLD - 1, CROSSED_MIN_THRESHOLD],
      [CROSSED_MAX_THRESHOLD + 1, CROSSED_MAX_THRESHOLD],
    ];
    for (const [asked, placed] of clamped) {
      const crossed = { entries: buildCrossedList(rows, placed), nextCursor: null };
      assert.deepEqual(boughtView(held, { mode: 'crossed', threshold: asked }), crossed);
    }
  });

  test('Curated matches the rules', async () => {
    const curated = await readCurated(db);
    assert.ok(curated.boughtByFollowed.length > 0 && curated.inTheirOwnWords.length > 0, 'the history fills Curated');
    assert.deepEqual(curated, buildCurated(rows));
  });

  test('a rebuild answers what folding page by page answered', async () => {
    for (const doc of later) await insertRawDocument(db, doc);
    await fold(db);
    const bought = await readBoughtReleases(db);
    const curated = await readCurated(db);
    const newReleases = await readNewReleases(db, { now: NOW });
    await rebuild(db);
    assert.deepEqual(await readBoughtReleases(db), bought);
    assert.deepEqual(await readCurated(db), curated);
    assert.deepEqual(await readNewReleases(db, { now: NOW }), newReleases);
  });
});

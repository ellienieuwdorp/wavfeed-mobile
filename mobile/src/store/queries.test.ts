/// <reference types="node" />
/**
 * The store's view reads narrow the wide Story join in SQL; each must answer what the server's feed rules answer on
 * the full join (task 0036, decision 3), and a rebuild from the Raw Documents must answer the same again (ADR-0004).
 */
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import type { SQLiteDatabase } from 'expo-sqlite';

import { DAY, enterHistory, makeHistory, oracleRows } from '../../test/history';
import { openTestStore } from '../../test/nodeDb';
import { assembleFeed, itemKey } from '../domain/assemble';
import { buildBoughtChart } from '../domain/boughtChart';
import { buildCrossedList } from '../domain/boughtCrossed';
import { buildCurated } from '../domain/curate';
import { buildNewReleases } from '../domain/newReleases';
import type { FeedStoryRow } from '../domain/rows';
import { buildUpcoming } from '../domain/upcoming';
import { fold, rebuild } from './projection';
import { listUpcomingReleases, readBought, readCurated, readNewReleases } from './queries';
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
  assert.deepEqual(await readBought(db, { mode: 'released', now: NOW }), { weeks: [], nextCursor: null });
  assert.deepEqual(await readNewReleases(db, { now: NOW }), buildNewReleases([], [], NOW));
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

  test('Bought by release week and by Fans crossed match the rules', async () => {
    assert.deepEqual(await readBought(db, { mode: 'released', now: NOW }), { weeks: buildBoughtChart(rows), nextCursor: null });
    for (const threshold of [2, 3, 5, 10]) {
      const expected = buildCrossedList(rows, threshold);
      assert.ok(expected.length > 0, `some Release crosses ${threshold}`);
      assert.deepEqual(await readBought(db, { mode: 'crossed', threshold, now: NOW }), { entries: expected, nextCursor: null });
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
    const bought = await readBought(db, { mode: 'released', now: NOW });
    const curated = await readCurated(db);
    const newReleases = await readNewReleases(db, { now: NOW });
    await rebuild(db);
    assert.deepEqual(await readBought(db, { mode: 'released', now: NOW }), bought);
    assert.deepEqual(await readCurated(db), curated);
    assert.deepEqual(await readNewReleases(db, { now: NOW }), newReleases);
  });
});

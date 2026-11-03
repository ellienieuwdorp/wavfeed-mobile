/// <reference types="node" />
/**
 * The store's view reads over a long synthetic history (test/history.ts): each answers what the feed rules answer on
 * the full wide join, a rebuild from the Raw Documents answers the same again (ADR-0004), and the filter's counts match
 * the list it leaves.
 */
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import type { SQLiteDatabase } from 'expo-sqlite';

import { DAY, enterHistory, makeHistory, oracleRows } from '../../test/history';
import { openTestStore } from '../../test/nodeDb';
import { buildCurated } from '../domain/curate';
import { type NewReleasesView, newReleasesOf } from '../domain/newReleases';
import { filterNewReleases, PEOPLE_MAX, PEOPLE_MIN, type ReleaseFilter } from '../domain/releaseFilter';
import type { FeedStoryRow } from '../domain/rows';
import { fold, rebuild } from './projection';
import { listUpcomingReleases, readCurated, readNewReleases } from './queries';
import { insertRawDocument } from './rawDocuments';

const NOW = new Date(Date.UTC(2026, 8, 25, 12, 0, 0));
const SIZE = { pages: 100, releases: 800, fans: 120, purchases: 1600, wishes: 500 };

/**
 * Without Drops: the history holds no pre-order pages, so it writes none, and drops.test.ts holds their rules. `rows`
 * is the whole wide join with early Track Stories on their albums, so this checks which Stories the store's scope loads.
 */
async function newReleasesByRules(db: SQLiteDatabase, rows: readonly FeedStoryRow[], now: Date) {
  return newReleasesOf({ stories: rows, upcoming: await listUpcomingReleases(db, now), drops: [], now });
}

/**
 * Off the wide join alone, not through the domain: each Release's named buyers, and the Releases out by `now` that a
 * named Fan bought and no new-release Story or Upcoming row drew, which join the weeks as bought; undated ones stay out.
 */
function signalByRules(rows: readonly FeedStoryRow[], now: Date) {
  const key = (row: FeedStoryRow) => `${row.itemType}:${row.itemId}`;
  const buyers = new Map<string, Set<string>>();
  const announced = new Set<string>();
  for (const row of rows) {
    if (row.storyType === 'new_release') announced.add(key(row));
    if (row.storyType !== 'purchase' || row.fanId === null || row.fanUsername === null) continue;
    buyers.set(key(row), (buyers.get(key(row)) ?? new Set()).add(String(row.fanId)));
  }
  const bought = new Set<string>();
  for (const row of rows) {
    const out = row.releaseDate !== null && row.releaseDate.getTime() <= now.getTime();
    if (buyers.has(key(row)) && out && !announced.has(key(row))) bought.add(key(row));
  }
  return { buyers, bought };
}
describe('over a long history', () => {
  let db: SQLiteDatabase;
  let close: () => void;
  let rows: FeedStoryRow[];
  let onAlbums: FeedStoryRow[];
  let later: Awaited<ReturnType<typeof enterHistory>>;

  before(async () => {
    ({ db, close } = await openTestStore());
    later = await enterHistory(db, makeHistory(SIZE, NOW), NOW, 100);
    await fold(db);
    rows = await oracleRows(db);
    onAlbums = await oracleRows(db, { onAlbums: true });
  });
  after(() => close());

  test('New releases match the rules, today and 200 days back', async () => {
    const today = await readNewReleases(db, { now: NOW });
    assert.ok(today.weeks.length > 0 && today.upcoming.length > 0, 'the history reaches both halves of the view');
    const entries = today.weeks.flatMap((week) => week.releases);
    assert.ok(entries.some((entry) => entry.key.startsWith('bought:')), 'a Release only Fans bought joins the weeks');
    assert.ok(entries.some((entry) => entry.key.startsWith('item:') && entry.release.buyers.length > 0), 'a released Feed Item carries buyers');
    const names = entries.map(({ release }) => release);
    assert.ok(names.some((r) => r.artistCredit !== null && r.artistCredit !== r.pageName), 'a credit differs from its Page');
    assert.ok(names.some((r) => r.artistCredit === null), 'a Release nothing credited');
    assert.equal((await db.getFirstAsync<{ n: number }>('select count(*) as n from drops'))?.n, 0, 'the history writes no Drop');
    assert.deepEqual(today, await newReleasesByRules(db, onAlbums, NOW));
    const earlier = new Date(NOW.getTime() - 200 * DAY);
    assert.deepEqual(await readNewReleases(db, { now: earlier }), await newReleasesByRules(db, onAlbums, earlier));

    const { buyers, bought } = signalByRules(onAlbums, NOW);
    const drawn = (key: string) => key.replace(/^(item|bought|upcoming):/, '');
    for (const entry of entries) {
      const held = [...(buyers.get(drawn(entry.key)) ?? [])].sort();
      assert.deepEqual(entry.release.buyers.map((fan) => fan.fanId).sort(), held, entry.key);
    }
    const shelf = new Set(today.upcoming.map((release) => `${release.itemType}:${release.itemId}`));
    const justOut = new Set(entries.filter((entry) => entry.key.startsWith('upcoming:')).map((entry) => drawn(entry.key)));
    assert.deepEqual(
      entries.filter((entry) => entry.key.startsWith('bought:')).map((entry) => drawn(entry.key)).sort(),
      [...bought].filter((key) => !shelf.has(key) && !justOut.has(key)).sort(),
    );
    const early = onAlbums.filter((row, i) => row.itemType === 'a' && rows[i]?.itemType === 't' && row.storyType === 'purchase');
    const albums = new Set(entries.filter((entry) => entry.key.startsWith('item:')).map((entry) => drawn(entry.key)));
    assert.ok(early.some((row) => albums.has(`a:${row.itemId}`)), "an early Track purchase counts on its album's released row");
  });

  test("the filter's counts match the list it leaves, for every minimum and every tag", async () => {
    const view = await readNewReleases(db, { now: NOW });
    const releasesIn = (shown: NewReleasesView) =>
      new Set([...shown.upcoming, ...shown.weeks.flatMap((week) => week.releases.map((entry) => entry.release))].map((r) => `${r.itemType}:${r.itemId}`)).size;
    const filters: ReleaseFilter[] = [
      { people: { on: false, min: 1 }, tags: [] },
      { people: { on: true, min: 2 }, tags: [] },
      { people: { on: true, min: 1 }, tags: ['dub', 'jazz'] },
    ];
    for (const filter of filters) {
      const result = filterNewReleases(view, filter);
      assert.equal(result.matching, releasesIn(result.view));
      assert.equal(result.total, releasesIn(view));
      assert.ok(result.view.weeks.every((week) => week.releases.length > 0), 'no week head over nothing');
      assert.deepEqual(result.tags.map((tag) => tag.normName).sort(), ['ambient', 'drone', 'dub', 'electronic', 'jazz', 'techno'], 'places are no tag');
      for (const tag of result.tags) {
        assert.equal(tag.count, filterNewReleases(view, { people: filter.people, tags: [tag.normName] }).matching, tag.normName);
      }
      assert.deepEqual(result.byMinimum.map(({ min }) => min), Array.from({ length: PEOPLE_MAX - PEOPLE_MIN + 1 }, (_, i) => PEOPLE_MIN + i));
      for (const { min, count } of result.byMinimum) {
        assert.equal(count, filterNewReleases(view, { people: { on: true, min }, tags: [] }).matching, `at least ${min}`);
      }
    }
    assert.ok(filterNewReleases(view, { people: { on: true, min: 2 }, tags: [] }).matching < releasesIn(view), 'the people minimum narrows the history');
  });

  test('Curated matches the rules', async () => {
    const curated = await readCurated(db);
    assert.ok(curated.boughtByFollowed.length > 0 && curated.inTheirOwnWords.length > 0, 'the history fills Curated');
    assert.deepEqual(curated, buildCurated(rows));
  });

  test('a rebuild answers what folding page by page answered', async () => {
    for (const doc of later) await insertRawDocument(db, doc);
    await fold(db);
    const curated = await readCurated(db);
    const newReleases = await readNewReleases(db, { now: NOW });
    await rebuild(db);
    assert.deepEqual(await readCurated(db), curated);
    assert.deepEqual(await readNewReleases(db, { now: NOW }), newReleases);
  });
});

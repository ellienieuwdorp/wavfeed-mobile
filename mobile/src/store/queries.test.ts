/// <reference types="node" />
/**
 * The store's view reads narrow the wide Story join in SQL; each must answer what the server's feed rules answer on
 * the full join (task 0036, decision 3), and a rebuild from the Raw Documents must answer the same again (ADR-0004).
 * Bought is read once and placed per mode on every switch, so that placing answers the rules at each threshold too.
 * The wishlist crumb's stand-in, a Release the store holds on a bandcamp.com host, is picked here as well, and the
 * player's tracklist off a stored release page, every Track the page names (task 0041, decision 5).
 */
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import type { SQLiteDatabase } from 'expo-sqlite';

import {
  feedPayload,
  ITEM_ID,
  nrEntry,
  PREORDER_ITEM_ID,
  PREORDER_URL,
  preorderNrEntry,
  phonePreorderTralbumBlob,
  preorderTralbumBlob,
  releasePagePayload,
  tralbumBlob,
} from '../../test/fixtures';
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
  readChainCounts,
  readCurated,
  readNewestBandcampReleaseUrl,
  readNewReleases,
  readTracklist,
} from './queries';
import { markReleasePageAttempt } from './enrichment';
import { insertRawDocument } from './rawDocuments';

const NOW = new Date(Date.UTC(2026, 8, 25, 12, 0, 0));
const SIZE = { pages: 100, releases: 800, fans: 120, purchases: 1600, wishes: 500 };

/** Without Drops: the history holds no pre-order pages, so it writes none, and drops.test.ts holds their rules. */
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

test('the tracklist names every Track of a pre-order, and only the one let out plays', async () => {
  const { db, close } = await openTestStore();
  const payload = releasePagePayload({ itemId: PREORDER_ITEM_ID, tralbum: preorderTralbumBlob() });
  await insertRawDocument(db, { endpoint: 'release_page', payload, fetchedAt: '2026-09-29T10:05:00.000Z' });
  const tracklist = await readTracklist(db, 'a', PREORDER_ITEM_ID);
  const tracks = tracklist?.tracks.map((track) => [track.trackNum, track.trackId, track.out, track.streamUrl !== null]);
  assert.deepEqual(tracks, [
    [1, '66602201', false, false],
    [2, '66602202', true, true],
    [3, '66602203', false, false],
    [4, '66602204', false, false],
  ]);
  close();
});

test('the tracklist names the Tracks not out that a phone\'s page gives no id', async () => {
  const { db, close } = await openTestStore();
  const payload = releasePagePayload({ itemId: PREORDER_ITEM_ID, tralbum: phonePreorderTralbumBlob() });
  await insertRawDocument(db, { endpoint: 'release_page', payload, fetchedAt: '2026-09-29T10:05:00.000Z' });
  const tracklist = await readTracklist(db, 'a', PREORDER_ITEM_ID);
  const tracks = tracklist?.tracks.map((track) => [track.trackNum, track.title, track.trackId, track.out, track.streamUrl !== null]);
  assert.deepEqual(tracks, [
    [1, 'Pupa', null, false, false],
    [2, 'Lamp Glass', '66602202', true, true],
    [3, 'Wing Dust', null, false, false],
    [4, 'Moth Season', null, false, false],
  ]);
  close();
});

test('in New releases a Feed Item sits on its release day, not on the day its one Story came (task 0041, decision 3)', async () => {
  const { db, close } = await openTestStore();
  // Out 14 August, its Story dated 18 August.
  const payload = feedPayload({ entries: [nrEntry()] });
  await insertRawDocument(db, { endpoint: 'fan_dash_feed_updates', payload, fetchedAt: '2026-08-18T08:00:00.000Z' });
  await fold(db);
  const { weeks } = await readNewReleases(db, { now: new Date(Date.UTC(2026, 7, 20, 12)) });
  assert.deepEqual(
    weeks.flatMap((week) => week.releases.map((placed) => [placed.key, placed.date])),
    [[`item:a:${ITEM_ID}`, new Date(2026, 7, 14)]],
  );
  close();
});

test('a pre-order the feed names stays out of the released weeks until its page dates it onto the shelf', async () => {
  const { db, close } = await openTestStore();
  const now = new Date(Date.UTC(2026, 8, 30, 12));
  const payload = feedPayload({ entries: [preorderNrEntry()] });
  await insertRawDocument(db, { endpoint: 'fan_dash_feed_updates', payload, fetchedAt: '2026-09-29T10:00:00.000Z' });
  await fold(db);
  const placed = async () => {
    const view = await readNewReleases(db, { now });
    return [view.upcoming.map((release) => release.itemId), view.weeks.flatMap((week) => week.releases.map((entry) => entry.key))];
  };
  assert.deepEqual(await placed(), [[], []]);

  const page = releasePagePayload({ itemId: PREORDER_ITEM_ID, itemUrl: PREORDER_URL, tralbum: preorderTralbumBlob() });
  await insertRawDocument(db, { endpoint: 'release_page', payload: page, fetchedAt: '2026-09-29T10:05:00.000Z' });
  await fold(db);
  assert.deepEqual(await placed(), [[String(PREORDER_ITEM_ID)], [`drop:a:${PREORDER_ITEM_ID}:2026-09-29`]]);
  close();
});

test("a reissue whose page states a day before its Story stays on the Story's day in New releases", async () => {
  const { db, close } = await openTestStore();
  // A new_release with no new_date, dated by its Story on 18 August; the player reads its page, which says 1994.
  const feedRead = (fetchedAt: string, collected: number) => ({
    endpoint: 'fan_dash_feed_updates',
    payload: feedPayload({ entries: [nrEntry({ new_date: null, also_collected_count: collected })] }),
    fetchedAt,
  });
  const old = '01 Jan 1994 00:00:00 GMT';
  const current = { ...(tralbumBlob().current as object), release_date: old };
  const page = releasePagePayload({ tralbum: tralbumBlob({ current, album_release_date: old }) });
  await insertRawDocument(db, feedRead('2026-08-18T08:00:00.000Z', 3));
  await insertRawDocument(db, { endpoint: 'release_page', payload: page, fetchedAt: '2026-08-18T09:00:00.000Z' });
  await insertRawDocument(db, feedRead('2026-08-19T08:00:00.000Z', 4));
  await fold(db);
  const { weeks } = await readNewReleases(db, { now: new Date(Date.UTC(2026, 7, 20, 12)) });
  assert.deepEqual(
    weeks.flatMap((week) => week.releases.map((placed) => [placed.key, placed.date])),
    [[`item:a:${ITEM_ID}`, new Date('2026-08-18T07:28:27.000Z')]],
  );
  close();
});

test('a Track with no file on a Release that is out is out, with no preview', async () => {
  const { db, close } = await openTestStore();
  await insertRawDocument(db, { endpoint: 'release_page', payload: releasePagePayload(), fetchedAt: '2026-09-29T10:05:00.000Z' });
  const tracks = (await readTracklist(db, 'a', ITEM_ID))?.tracks;
  assert.deepEqual(tracks?.map((track) => [track.title, track.out, track.streamUrl !== null]), [
    ['Low Tide', true, true],
    ['Slow Harbour', true, true],
    ['Silt', true, false],
  ]);
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
    assert.equal((await db.getFirstAsync<{ n: number }>('select count(*) as n from drops'))?.n, 0, 'the history writes no Drop');
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

test("a gather chain's counts: every feed page held, and only the release pages booked failed since the chain began", async () => {
  const { db } = await openTestStore();
  const start = new Date(Date.UTC(2026, 8, 29, 12, 0, 0));
  const later = new Date(start.getTime() + 60_000);
  for (const itemId of [1, 2, 3]) {
    await insertRawDocument(db, { endpoint: 'fan_dash_feed_updates', payload: feedPayload({ entries: [nrEntry({ item_id: itemId })] }), fetchedAt: later.toISOString() });
  }
  await insertRawDocument(db, { endpoint: 'release_page', payload: releasePagePayload(), fetchedAt: later.toISOString() });
  await markReleasePageAttempt(db, { itemType: 'a', itemId: 10 }, 'failed', new Date(start.getTime() - 1));
  await markReleasePageAttempt(db, { itemType: 'a', itemId: 11 }, 'failed', later);
  await markReleasePageAttempt(db, { itemType: 'a', itemId: 12 }, 'gone', later);
  await markReleasePageAttempt(db, { itemType: 'a', itemId: 13 }, 'dated', later);
  assert.deepEqual(await readChainCounts(db, start), { feedPages: 3, releasePagesFailed: 1 });
});

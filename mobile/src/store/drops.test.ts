/// <reference types="node" />
/**
 * Drops from Raw Documents: each read that shows more Tracks of an Upcoming Release
 * playing than any before writes one, dated on the Release's first read by the page's publish date or the Story's, and
 * after it by the read unless a Track page of a Track it let out dates it inside the window between the reads; one per
 * GMT day; and a rebuild from scratch writes the same Drops on the same days (ADR-0004). A Track of the Release bought
 * alone is the Release on the shelf and in the weeks, and opens it when no other read has.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { SQLiteDatabase } from 'expo-sqlite';

import {
  bandDetailsPayload,
  discographyItem,
  feedPayload,
  followingBandsFirstPage,
  PREORDER_ITEM_ID,
  PREORDER_RELEASE_DATE,
  PREORDER_URL,
  preorderNrEntry,
  preorderTrackId,
  preorderTrackPageBlob,
  preorderTrackPurchase,
  preorderTralbumBlob,
  releasePagePayload,
} from '../../test/fixtures';
import { openTestStore } from '../../test/nodeDb';
import { BAND_DETAILS_ENDPOINT, FEED_UPDATES_ENDPOINT, FOLLOWING_BANDS_ENDPOINT, RELEASE_PAGE_ENDPOINT } from '../domain/endpoints';
import { readUpcomingDue } from './enrichment';
import { fold, rebuild } from './projection';
import { listDrops, readNewReleases } from './queries';
import { insertRawDocument, type RawDocumentInput } from './rawDocuments';

/** The feed's entry for the pre-order, rewritten in place: `playing` Tracks, and a count that moves so no two reads dedupe. */
function feedRead(fetchedAt: string, playing: number, collected: number): RawDocumentInput {
  const entry = preorderNrEntry({ num_streamable_tracks: playing, also_collected_count: collected });
  return { endpoint: FEED_UPDATES_ENDPOINT, payload: feedPayload({ entries: [entry] }), fetchedAt };
}

/** The album page with the Tracks numbered in `out` playing. */
function albumRead(fetchedAt: string, out: readonly number[]): RawDocumentInput {
  const payload = releasePagePayload({ itemId: PREORDER_ITEM_ID, itemUrl: PREORDER_URL, tralbum: preorderTralbumBlob({}, out) });
  return { endpoint: RELEASE_PAGE_ENDPOINT, payload, fetchedAt };
}

function trackRead(fetchedAt: string, trackNum: number, modDate: string): RawDocumentInput {
  const payload = releasePagePayload({
    itemType: 't',
    itemId: preorderTrackId(trackNum),
    itemUrl: `https://nightgraft.bandcamp.com/track/${trackNum}`,
    tralbum: preorderTrackPageBlob(trackNum, modDate),
  });
  return { endpoint: RELEASE_PAGE_ENDPOINT, payload, fetchedAt };
}

/** A feed read in which a Fan bought the pre-order's second Track alone. */
function trackBought(fetchedAt: string): RawDocumentInput {
  return { endpoint: FEED_UPDATES_ENDPOINT, payload: feedPayload({ entries: [preorderTrackPurchase(2)] }), fetchedAt };
}

/** Each read stored and folded before the next, as a gather turn does. */
async function gathered(reads: readonly RawDocumentInput[]): Promise<{ db: SQLiteDatabase; close: () => void }> {
  const store = await openTestStore();
  for (const read of reads) {
    await insertRawDocument(store.db, read);
    await fold(store.db);
  }
  return store;
}

/** Day, Tracks playing, Tracks named, and the newest Track let out, newest day first. */
async function drops(db: SQLiteDatabase) {
  return (await listDrops(db)).map((drop) => [drop.day, drop.tracksOut, drop.numTracks, drop.newestTrackId]);
}

/** The Fan's follow list with the pre-order's Page on it. */
const FOLLOWED: RawDocumentInput = { endpoint: FOLLOWING_BANDS_ENDPOINT, payload: followingBandsFirstPage(), fetchedAt: '2026-09-28T08:00:00.000Z' };

const ANNOUNCED = [feedRead('2026-09-29T10:00:00.000Z', 1, 3), albumRead('2026-09-29T10:05:00.000Z', [2])];

test('the feed and the pages write a Drop per rise, a Track page dates the later one, and a rebuild writes the same', async () => {
  const { db, close } = await gathered([
    ...ANNOUNCED,
    // The feed entry is rewritten with a second Track playing; the page read after it names that Track.
    feedRead('2026-10-05T09:00:00.000Z', 2, 4),
    albumRead('2026-10-05T09:10:00.000Z', [2, 3]),
    trackRead('2026-10-05T09:11:00.000Z', 3, '03 Oct 2026 17:02:11 GMT'),
  ]);
  const expected = [
    ['2026-10-03', 2, 4, preorderTrackId(3)],
    // The first Drop sits on the Story's date: no page was held when the feed named it.
    ['2026-09-29', 1, 4, preorderTrackId(2)],
  ];
  assert.deepEqual(await drops(db), expected);

  const now = new Date(Date.UTC(2026, 9, 6, 12));
  const view = await readNewReleases(db, { now });
  const placed = view.weeks.flatMap((week) => week.releases);
  assert.deepEqual(
    placed.map((entry) => (entry.kind === 'drop' ? [entry.key, entry.date, entry.tracksOut, entry.numTracks, entry.releaseDay, entry.newestTrackId] : entry.key)),
    [
      [`drop:a:${PREORDER_ITEM_ID}:2026-10-03`, new Date(2026, 9, 3), 2, 4, new Date(2026, 9, 13), String(preorderTrackId(3))],
      [`drop:a:${PREORDER_ITEM_ID}:2026-09-29`, new Date(2026, 8, 29), 1, 4, new Date(2026, 9, 13), String(preorderTrackId(2))],
    ],
    'the Release itself is on the shelf, its Drops in the weeks',
  );
  assert.deepEqual(
    view.upcoming.map((release) => [release.itemId, release.numStreamableTracks, release.numTracks]),
    [[String(PREORDER_ITEM_ID), 2, 4]],
  );

  const held = () => db.getAllAsync('select * from drops order by item_type, item_id, day');
  const folded = await held();
  await rebuild(db);
  assert.deepEqual(await held(), folded);
  assert.deepEqual(await drops(db), expected);
  close();
});

test('a Drop compares against the previous observation when an earlier page body returned', async (t) => {
  const { db, close } = await gathered([
    ...ANNOUNCED,
    albumRead('2026-10-02T12:00:00.000Z', [2, 3]),
    albumRead('2026-10-03T12:00:00.000Z', [2]),
    albumRead('2026-10-04T12:00:00.000Z', [2, 3, 4]),
  ]);
  t.after(close);
  const held = () => db.getFirstAsync<{ after_read_at: string; track_ids: string }>(
    "select after_read_at, track_ids from drops where item_type = 'a' and item_id = ? and day = '2026-10-04'", [PREORDER_ITEM_ID],
  );
  const expected = { after_read_at: '2026-10-03T12:00:00.000Z', track_ids: JSON.stringify([preorderTrackId(3), preorderTrackId(4)]) };
  assert.deepEqual({ ...await held() }, expected);
  await rebuild(db);
  assert.deepEqual({ ...await held() }, expected);
});

test("a Track page moment outside the reads' window leaves the Drop on its read's day, and the newest inside dates it", async () => {
  const later = [...ANNOUNCED, albumRead('2026-10-08T12:00:00.000Z', [2, 3, 4])];
  const edits = [
    // An edit after the read that showed more, and a moment before the read that showed fewer.
    trackRead('2026-10-08T12:01:00.000Z', 3, '10 Oct 2026 08:00:00 GMT'),
    trackRead('2026-10-08T12:02:00.000Z', 4, '20 Sep 2026 08:00:00 GMT'),
  ];
  let store = await gathered([...later, ...edits]);
  assert.deepEqual(await drops(store.db), [
    ['2026-10-08', 3, 4, preorderTrackId(4)],
    ['2026-09-29', 1, 4, preorderTrackId(2)],
  ]);
  store.close();

  store = await gathered([
    ...later,
    trackRead('2026-10-08T12:01:00.000Z', 3, '06 Oct 2026 10:00:00 GMT'),
    trackRead('2026-10-08T12:02:00.000Z', 4, '07 Oct 2026 21:40:00 GMT'),
  ]);
  assert.deepEqual((await drops(store.db)).map(([day]) => day), ['2026-10-07', '2026-09-29']);
  store.close();
});

test('a first rise after reads that showed none playing sits in their window, not on the publish date', async () => {
  const quiet = [feedRead('2026-09-29T10:00:00.000Z', 0, 3), albumRead('2026-09-29T10:05:00.000Z', [])];
  let store = await gathered([...quiet, albumRead('2026-10-06T08:00:00.000Z', [2])]);
  assert.deepEqual(await drops(store.db), [['2026-10-06', 1, 4, preorderTrackId(2)]]);
  store.close();

  // Its Track page dates it inside the window, as any later Drop's does.
  store = await gathered([
    ...quiet,
    albumRead('2026-10-06T08:00:00.000Z', [2]),
    trackRead('2026-10-06T08:01:00.000Z', 2, '03 Oct 2026 17:02:11 GMT'),
  ]);
  assert.deepEqual(await drops(store.db), [['2026-10-03', 1, 4, preorderTrackId(2)]]);
  store.close();
});

test('two rises on one GMT day are one Drop, with the later counts', async () => {
  const { db, close } = await gathered([
    ...ANNOUNCED,
    albumRead('2026-10-08T08:00:00.000Z', [2, 3]),
    albumRead('2026-10-08T20:00:00.000Z', [2, 3, 4]),
  ]);
  assert.deepEqual(await drops(db), [
    ['2026-10-08', 3, 4, preorderTrackId(4)],
    ['2026-09-29', 1, 4, preorderTrackId(2)],
  ]);
  close();
});

test("a Release only the Sweep found drops on its page's publish date, and a read on its release day writes none", async () => {
  const item = discographyItem({ item_id: PREORDER_ITEM_ID, item_url: PREORDER_URL, title: 'Moth Season', release_date: PREORDER_RELEASE_DATE });
  const sweep = { endpoint: BAND_DETAILS_ENDPOINT, payload: bandDetailsPayload({ items: [item] }), fetchedAt: '2026-09-30T08:00:00.000Z' };
  const { db, close } = await gathered([
    FOLLOWED,
    sweep,
    albumRead('2026-10-01T08:00:00.000Z', [2]),
    // Out: every Track plays, and the Release is no longer Upcoming.
    albumRead('2026-10-13T10:00:00.000Z', [1, 2, 3, 4]),
  ]);
  assert.deepEqual(await drops(db), [['2026-09-29', 1, 4, preorderTrackId(2)]]);
  close();
});

test('a Drop is drawn only while its Page is followed or a Story reaches its Release, as the shelf is', async () => {
  const item = discographyItem({ item_id: PREORDER_ITEM_ID, item_url: PREORDER_URL, title: 'Moth Season', release_date: PREORDER_RELEASE_DATE });
  const sweep = { endpoint: BAND_DETAILS_ENDPOINT, payload: bandDetailsPayload({ items: [item] }), fetchedAt: '2026-09-30T08:00:00.000Z' };
  const { db, close } = await gathered([sweep, albumRead('2026-10-01T08:00:00.000Z', [2])]);
  const view = await readNewReleases(db, { now: new Date(Date.UTC(2026, 9, 2, 12)) });
  assert.deepEqual(await drops(db), []);
  assert.deepEqual([view.upcoming.length, view.weeks.length], [0, 0]);
  close();
});

test("a Track bought alone is its album on the shelf, in the weeks and on its release day, and its buyer is the album's", async () => {
  const { db, close } = await gathered([
    ...ANNOUNCED,
    trackBought('2026-10-02T21:09:00.000Z'),
    trackRead('2026-10-02T23:21:00.000Z', 2, '29 Sep 2026 09:12:40 GMT'),
  ]);
  const placed = async (now: Date) => {
    const view = await readNewReleases(db, { now });
    return {
      shelf: view.upcoming.map((release) => [release.itemType, release.itemId, release.numStreamableTracks, release.numTracks, release.buyers.length]),
      weeks: view.weeks.flatMap((week) => week.releases.map((entry) => entry.key)),
    };
  };

  assert.deepEqual(await placed(new Date(Date.UTC(2026, 9, 12, 15))), {
    shelf: [['a', String(PREORDER_ITEM_ID), 1, 4, 1]],
    weeks: [`drop:a:${PREORDER_ITEM_ID}:2026-09-29`],
  });
  assert.deepEqual((await placed(new Date(Date.UTC(2026, 9, 13, 12)))).weeks, [
    `item:a:${PREORDER_ITEM_ID}`,
    `drop:a:${PREORDER_ITEM_ID}:2026-09-29`,
  ]);
  close();
});

test('a Track page opens the Upcoming album no other read named, which is drawn and read in its place', async () => {
  const { db, close } = await gathered([
    trackBought('2026-10-02T21:09:00.000Z'),
    trackRead('2026-10-02T23:21:00.000Z', 2, '29 Sep 2026 09:12:40 GMT'),
  ]);
  const now = new Date(Date.UTC(2026, 9, 3, 12));
  const view = await readNewReleases(db, { now });

  assert.deepEqual(
    view.upcoming.map((release) => [release.itemType, release.itemId, release.title, release.itemUrl, release.releaseDate, release.numTracks, release.buyers.length]),
    [['a', String(PREORDER_ITEM_ID), 'Moth Season', PREORDER_URL, '2026-10-13T00:00:00.000Z', null, 1]],
  );
  assert.deepEqual(view.weeks, []);
  assert.deepEqual(await readUpcomingDue(db, 10, now), [{ itemType: 'a', itemId: PREORDER_ITEM_ID, url: PREORDER_URL }]);
  close();
});

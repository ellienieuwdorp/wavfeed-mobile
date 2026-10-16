/// <reference types="node" />
/**
 * The store's view reads narrow the wide Story join in SQL; each must answer what the server's feed rules answer on
 * the full join (task 0036, decision 3), and a rebuild from the Raw Documents must answer the same again (ADR-0004).
 * The wishlist crumb's stand-in, a Release the store holds on a bandcamp.com host, is picked here as well, and the
 * player's tracklist off a stored release page, every Track the page names (task 0041, decision 5). A Track bought
 * before its album came out counts as the album on New releases' released rows (task 0067, decision 3; task 0071,
 * decision 19). The filter's counts match the list it leaves over the long history (task 0071, decision 21).
 */
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import type { SQLiteDatabase } from 'expo-sqlite';

import {
  BAND_ID,
  bandDetailsPayload,
  discographyItem,
  followingBandsFirstPage,
  FAN_ID,
  fanInfo,
  feedPayload,
  fpEntry,
  fwEntry,
  ITEM_ID,
  OTHER_FAN_ID,
  nrEntry,
  PREORDER_ITEM_ID,
  PREORDER_URL,
  preorderNrEntry,
  phonePreorderTralbumBlob,
  preorderTrackId,
  preorderTrackPurchase,
  preorderTralbumBlob,
  releasePagePayload,
  tralbumBlob,
} from '../../test/fixtures';
import { DAY, enterHistory, type History, makeHistory, oracleRows } from '../../test/history';
import { openTestStore } from '../../test/nodeDb';
import { buildCurated } from '../domain/curate';
import { type NewReleasesView, newReleasesOf } from '../domain/newReleases';
import { filterNewReleases, PEOPLE_MAX, PEOPLE_MIN, type ReleaseFilter } from '../domain/releaseFilter';
import type { FeedStoryRow } from '../domain/rows';
import { fold, rebuild } from './projection';
import {
  listUpcomingReleases,
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

/**
 * Without Drops: the history holds no pre-order pages, so it writes none, and drops.test.ts holds their rules. `rows`
 * is the whole wide join with early Track Stories on their albums, so this checks which Stories the store's scope loads.
 */
async function newReleasesByRules(db: SQLiteDatabase, rows: readonly FeedStoryRow[], now: Date) {
  return newReleasesOf({ stories: rows, upcoming: await listUpcomingReleases(db, now), drops: [], now });
}

/**
 * Off the wide join alone, not through the domain: each Release's named buyers, and the Releases out by `now` that a
 * named Fan bought and no new-release Story or Upcoming row drew, which join the weeks as bought (task 0071, decisions
 * 19 and 20; Open 9 keeps the undated out).
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

test('an empty store answers every view as the rules answer no Stories', async () => {
  const { db, close } = await openTestStore();
  assert.deepEqual(await readCurated(db), buildCurated([]));
  assert.deepEqual(await readNewReleases(db, { now: NOW }), { upcoming: [], weeks: [] });
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

test("on New releases a Track bought before its album came out is a buyer on the album's released row", async () => {
  const { db, close } = await openTestStore();
  const trackBought = fpEntry({
    item_type: 't', item_id: 77001, album_id: ITEM_ID, item_title: 'Low Tide', item_url: 'https://nightgraft.bandcamp.com/track/low-tide',
    story_date: '10 Aug 2026 09:00:00 GMT', purchased: '10 Aug 2026 09:00:00 GMT',
  });
  await insertRawDocument(db, { endpoint: 'fan_dash_feed_updates', payload: feedPayload({ entries: [nrEntry(), trackBought] }), fetchedAt: '2026-08-18T08:00:00.000Z' });
  await fold(db);
  const { weeks } = await readNewReleases(db, { now: new Date(Date.UTC(2026, 7, 20, 12)) });
  assert.deepEqual(
    weeks.flatMap((week) => week.releases.map((entry) => [entry.key, 'buyers' in entry.release ? entry.release.buyers.map((fan) => fan.username) : []])),
    [[`item:a:${ITEM_ID}`, ['diggerfan']]],
  );
  close();
});

test('on New releases an album only an early Track purchase reached carries its own wishlisters too', async () => {
  const { db, close } = await openTestStore();
  const trackBought = fpEntry({
    item_type: 't', item_id: 77001, album_id: ITEM_ID, item_title: 'Low Tide', item_url: 'https://nightgraft.bandcamp.com/track/low-tide',
    story_date: '01 Aug 2026 09:00:00 GMT', purchased: '01 Aug 2026 09:00:00 GMT',
  });
  const albumWished = fwEntry({ fan_id: OTHER_FAN_ID });
  const payload = feedPayload({
    entries: [trackBought, albumWished],
    fanInfo: { [String(FAN_ID)]: fanInfo(), [String(OTHER_FAN_ID)]: fanInfo({ fan_id: OTHER_FAN_ID, username: 'otherfan' }) },
  });
  await insertRawDocument(db, { endpoint: 'fan_dash_feed_updates', payload, fetchedAt: '2026-08-18T08:00:00.000Z' });
  await insertRawDocument(db, { endpoint: 'release_page', payload: releasePagePayload(), fetchedAt: '2026-08-18T09:00:00.000Z' });
  await fold(db);
  const { weeks } = await readNewReleases(db, { now: new Date(Date.UTC(2026, 7, 20, 12)) });
  assert.deepEqual(
    weeks.flatMap((week) => week.releases.map(({ key, release }) => [key, release.buyers.map((fan) => fan.username), release.wishlisters.map((fan) => fan.username)])),
    [[`bought:a:${ITEM_ID}`, ['diggerfan'], ['otherfan']]],
  );
  close();
});

test('selected Releases retain older buyers and reviews beyond 50,000 newer Stories', async () => {
  const { db, close } = await openTestStore();
  try {
    const now = new Date('2026-10-12T12:00:00.000Z');
    const recent = new Date('2026-10-12T10:00:00.000Z').getTime();
    const releases: History['releases'] = Array.from({ length: 100 }, (_, index) => ({
      type: 'a', id: 10000 + index, band: 1000 + index,
      at: Date.parse('2026-10-13T00:00:00.000Z'), shown: 'story',
    }));
    const stories: History['stories'] = releases.flatMap((release) => [
      { kind: 'nr' as const, fan: null, release, at: recent, why: null },
      ...Array.from({ length: 500 }, (_, fan) => ({
        kind: 'fp' as const, fan: 100000 + fan, release, at: recent, why: null,
      })),
    ]);
    await enterHistory(db, { releases, stories }, now);
    const thirdFanId = FAN_ID + 1;
    const albumPurchase = (fanId: number, date: string) => fpEntry({
      fan_id: fanId, story_date: date, purchased: date,
      item_id: PREORDER_ITEM_ID, album_id: PREORDER_ITEM_ID,
      item_title: 'Moth Season', album_title: 'Moth Season', item_url: PREORDER_URL, is_preorder: true,
    });
    await insertRawDocument(db, {
      endpoint: 'fan_dash_feed_updates', fetchedAt: now.toISOString(),
      payload: feedPayload({
        entries: [
          preorderTrackPurchase(2, { story_date: '01 Oct 2026 10:00:00 GMT', purchased: '01 Oct 2026 10:00:00 GMT', why: 'The older Track review' }),
          albumPurchase(OTHER_FAN_ID, '02 Oct 2026 10:00:00 GMT'),
          albumPurchase(thirdFanId, '12 Oct 2026 11:00:00 GMT'),
          preorderNrEntry({ story_date: '12 Oct 2026 11:00:00 GMT' }),
        ],
        fanInfo: {
          [String(FAN_ID)]: fanInfo(),
          [String(OTHER_FAN_ID)]: fanInfo({ fan_id: OTHER_FAN_ID, username: 'secondfan' }),
          [String(thirdFanId)]: fanInfo({ fan_id: thirdFanId, username: 'thirdfan' }),
        },
      }),
    });
    await insertRawDocument(db, {
      endpoint: 'release_page', fetchedAt: now.toISOString(),
      payload: releasePagePayload({ itemId: PREORDER_ITEM_ID, itemUrl: PREORDER_URL, tralbum: preorderTralbumBlob() }),
    });
    await fold(db);
    assert.equal((await db.getFirstAsync<{ n: number }>('select count(*) as n from stories'))?.n, 50104);

    const curated = (await readCurated(db)).newFromPages.find((item) => item.itemId === String(PREORDER_ITEM_ID));
    assert.ok(curated);
    const view = await readNewReleases(db, { now });
    const upcoming = view.upcoming.find((item) => item.itemId === String(PREORDER_ITEM_ID));
    assert.ok(upcoming);
    const drawn = [...view.upcoming, ...view.weeks.flatMap((week) => week.releases.map((entry) => entry.release))];
    assert.deepEqual({
      trackDrawn: drawn.some((release) => release.itemType === 't' && release.itemId === String(preorderTrackId(2))),
      curatedBuyers: curated.buyers.map((fan) => fan.fanId),
      upcomingBuyers: upcoming.buyers.map((fan) => fan.fanId),
      upcomingReviews: upcoming.reviews.map(({ text }) => text),
    }, {
      trackDrawn: false,
      // Curated keeps the Track's own Story (task 0067); the album's older purchase still belongs to its full read.
      curatedBuyers: [thirdFanId, OTHER_FAN_ID].map(String),
      upcomingBuyers: [thirdFanId, OTHER_FAN_ID, FAN_ID].map(String),
      upcomingReviews: ['The older Track review'],
    });
  } finally {
    close();
  }
});

test('the just-out handoff and Upcoming each retain 500 Releases in date and key order', async (t) => {
  const { db, close } = await openTestStore();
  t.after(close);
  const now = new Date('2026-10-12T23:59:59.999Z');
  const item = (id: number, date: string, type = 'album') => discographyItem({
    item_id: id, item_type: type, title: `Release ${id}`, release_date: date,
  });
  await insertRawDocument(db, {
    endpoint: 'following_bands', payload: followingBandsFirstPage(), fetchedAt: '2026-09-20T00:00:00.000Z',
  });
  await insertRawDocument(db, {
    endpoint: 'band_details', fetchedAt: '2026-09-20T01:00:00.000Z',
    payload: bandDetailsPayload({ items: [
      ...Array.from({ length: 501 }, (_, i) => item(10000 + i, '11 Oct 2026 00:00:00 GMT')),
      // Reverse admission order, an album and a standalone Track sharing an id, and tied cutoff dates.
      item(40000, '30 Oct 2026 00:00:00 GMT'),
      item(30000, '14 Oct 2026 00:00:00 GMT', 'track'),
      item(30002, '14 Oct 2026 00:00:00 GMT'),
      item(30001, '14 Oct 2026 00:00:00 GMT'),
      item(20000, '13 Oct 2026 00:00:00 GMT', 'track'),
      ...Array.from({ length: 497 }, (_, i) => item(20496 - i, '13 Oct 2026 00:00:00 GMT')),
    ] }),
  });
  await fold(db);
  const justOut = Array.from({ length: 500 }, (_, i) => ['a', 10000 + i]);
  const future = [
    ...Array.from({ length: 497 }, (_, i) => ['a', 20000 + i]),
    ['t', 20000], ['a', 30001], ['a', 30002],
  ];
  const held = await listUpcomingReleases(db, now);
  assert.deepEqual(held.map((release) => [release.itemType, release.itemId]), [...justOut, ...future]);
  const view = await readNewReleases(db, { now });
  assert.deepEqual(view.upcoming.map((release) => [release.itemType, Number(release.itemId)]), future);
  assert.deepEqual(view.weeks.flatMap((week) => week.releases.map((entry) => [entry.release.itemType, Number(entry.release.itemId)])), justOut);
});

test('an Upcoming Release a followed Fan bought stays on the shelf past 500 nearer ones (task 0071)', async (t) => {
  const { db, close } = await openTestStore();
  t.after(close);
  const now = new Date('2026-10-12T23:59:59.999Z');
  const item = (id: number, date: string) => discographyItem({ item_id: id, item_type: 'album', title: `Release ${id}`, release_date: date });
  await insertRawDocument(db, {
    endpoint: 'following_bands', payload: followingBandsFirstPage(), fetchedAt: '2026-09-20T00:00:00.000Z',
  });
  await insertRawDocument(db, {
    endpoint: 'band_details', fetchedAt: '2026-09-20T01:00:00.000Z',
    payload: bandDetailsPayload({ items: [
      ...Array.from({ length: 500 }, (_, i) => item(20000 + i, '13 Oct 2026 00:00:00 GMT')),
      item(50000, '30 Nov 2026 00:00:00 GMT'),
      item(50001, '30 Nov 2026 00:00:00 GMT'),
      item(50002, '30 Nov 2026 00:00:00 GMT'),
    ] }),
  });
  // 50000 bought whole, 50001 through one of its Tracks; 50002 nobody bought.
  await insertRawDocument(db, {
    endpoint: 'fan_dash_feed_updates', fetchedAt: '2026-10-01T00:00:00.000Z',
    payload: feedPayload({ entries: [
      fpEntry({ item_id: 50000, album_id: 50000, item_title: 'Release 50000', item_url: 'https://nightgraft.bandcamp.com/album/r50000' }),
      fpEntry({ item_type: 't', item_id: 77002, album_id: 50001, item_title: 'Early', item_url: 'https://nightgraft.bandcamp.com/track/early' }),
    ] }),
  });
  await fold(db);
  const view = await readNewReleases(db, { now });
  const ids = (releases: readonly { readonly itemId: string | number }[]) => releases.map((release) => Number(release.itemId));
  assert.equal(view.upcoming.length, 502);
  assert.deepEqual(ids(view.upcoming).slice(-2), [50000, 50001]);
  assert.deepEqual(ids(filterNewReleases(view, { people: { on: true, min: PEOPLE_MIN }, tags: [] }).view.upcoming), [50000, 50001]);
});

test('both Upcoming query halves preserve the GMT window, prior holding and follow-or-Story reach', async (t) => {
  const { db, close } = await openTestStore();
  t.after(close);
  const item = (id: number, date: string | null, type = 'album', band = BAND_ID) => discographyItem({
    item_id: id, item_type: type, band_id: band, title: `Release ${id}`, release_date: date,
  });
  await insertRawDocument(db, {
    endpoint: 'following_bands', payload: followingBandsFirstPage(), fetchedAt: '2026-09-20T00:00:00.000Z',
  });
  await insertRawDocument(db, {
    endpoint: 'band_details', fetchedAt: '2026-09-20T01:00:00.000Z',
    payload: bandDetailsPayload({ items: [
      item(1, '28 Sep 2026 00:00:00 GMT'), item(2, '12 Oct 2026 00:00:00 GMT'),
      item(3, '13 Oct 2026 00:00:00 GMT'), item(4, '01 Nov 2026 00:00:00 GMT'),
      item(5, '27 Sep 2026 00:00:00 GMT'), item(6, null),
      item(11, '13 Oct 2026 00:00:00 GMT', 'track'),
    ] }),
  });
  await insertRawDocument(db, {
    endpoint: 'band_details', fetchedAt: '2026-09-20T01:00:00.000Z',
    payload: bandDetailsPayload({ bandId: 2, items: [
      item(7, '13 Oct 2026 00:00:00 GMT', 'album', 2),
      item(8, '13 Oct 2026 00:00:00 GMT', 'album', 2),
    ] }),
  });
  await insertRawDocument(db, {
    endpoint: 'band_details', fetchedAt: '2026-10-12T00:00:00.000Z',
    payload: bandDetailsPayload({ items: [item(9, '12 Oct 2026 00:00:00 GMT'), item(10, '11 Oct 2026 00:00:00 GMT')] }),
  });
  await insertRawDocument(db, {
    endpoint: 'fan_dash_feed_updates', fetchedAt: '2026-10-12T01:00:00.000Z',
    payload: feedPayload({ entries: [
      fpEntry({ item_id: 8, album_id: 8, band_id: 2, item_url: 'https://other.bandcamp.com/album/eight' }),
      fpEntry({ item_type: 't', item_id: 11, album_id: 3, item_url: 'https://nightgraft.bandcamp.com/track/eleven' }),
    ] }),
  });
  await fold(db);
  const now = new Date('2026-10-12T23:59:59.999Z');
  // Every exclusion has a valid dated Release and held Page, except the explicitly undated control.
  assert.equal((await db.getFirstAsync<{ album_id: number }>("select album_id from releases where item_type = 't' and item_id = 11"))?.album_id, 3);
  assert.deepEqual((await listUpcomingReleases(db, now)).map((release) => release.itemId), [1, 2, 3, 8, 4]);
  assert.deepEqual((await readNewReleases(db, { now })).upcoming.map((release) => release.itemId), ['3', '8', '4']);
  assert.deepEqual((await readNewReleases(db, { now: new Date('2026-10-13T00:00:00.000Z') })).upcoming.map((release) => release.itemId), ['4']);
});

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

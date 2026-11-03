/// <reference types="node" />
/**
 * Migration 3 on a store that already holds feed pokes as HTML (ADR-0003, ADR-0004 amendment 2026-09-29): those rows
 * go, their crumbs with them down to the database file's bytes, and every other Raw Document stays. Migration 5 and the
 * replay after it on a store that filed a pre-order by its feed date: the Release is Upcoming again.
 * Migration 7 on a store whose release pages were asked for as a phone: each Upcoming page, and each Track page a Drop
 * still dated by its read came back with, is due once more, and never again for that reason. Migration 11
 * and its replay credit the artists the held feed pages name. A store a newer bundle migrated
 * past the code opens as it is and is reported (review finding ARCH-13).
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import type { SQLiteDatabase } from 'expo-sqlite';

import {
  BAND_ID,
  feedPayload,
  nrEntry,
  PREORDER_ITEM_ID,
  PREORDER_URL,
  phonePreorderTralbumBlob,
  preorderNrEntry,
  preorderTrackId,
  preorderTrackPageBlob,
  preorderTrackPurchase,
  preorderTralbumBlob,
  releasePagePayload,
} from '../../test/fixtures';
import { openTestStore } from '../../test/nodeDb';
import { FEED_UPDATES_ENDPOINT, RELEASE_PAGE_ENDPOINT, type ReleaseKey } from '../domain/endpoints';
import type { ErrorReport } from '../tally/errorReport';
import { errorReports } from '../tally/errors';
import { turnSharingOn } from '../tally/outbox';
import { markReleasePageAttempt, readOwedTrackPages, readUndatedReleases, readUpcomingDue } from './enrichment';
import { migrate } from './migrations';
import { ensureProjectionVersion, fold, PROJECTION_VERSION_KEY } from './projection';
import { listDrops, listUpcomingReleases, readNewReleases } from './queries';
import { countForProjection, insertRawDocument, listForProjection, type RawDocumentInput } from './rawDocuments';

/** Undoes the migrations after `version`, so a test starts from the store a device held then. */
async function heldAt(db: SQLiteDatabase, version: number): Promise<void> {
  if (version < 11) await db.execAsync('alter table releases drop column artist_credit;');
  if (version < 10) await db.execAsync('drop trigger raw_document_observed; drop table projection_snapshots; drop table projection_observation_progress; drop table raw_document_observations;');
  if (version < 9) await db.execAsync('drop index releases_album_id;');
  if (version < 8) await db.execAsync('drop table projection_failures;');
  if (version < 7) await db.execAsync('alter table release_page_attempts drop column asked_as_phone;');
  if (version < 6) {
    await db.execAsync(`
      drop table drops;
      alter table releases drop column feed_tracks_out;
      alter table releases drop column feed_tracks_read_at;
      alter table releases drop column page_tracks_out;
      alter table releases drop column page_tracks_read_at;
    `);
  }
  if (version < 5) {
    await db.execAsync(`
      alter table releases drop column release_date_source;
      alter table releases drop column release_date_read_at;
      alter table releases drop column num_tracks;
    `);
  }
  if (version < 4) await db.execAsync('drop table tally_outbox;');
  await db.runAsync('delete from schema_migrations where version > ?', [version]);
}

/** The old bundle's insertion contract, used only to construct pre-observation migration fixtures. */
async function insertLegacyRaw(db: SQLiteDatabase, input: RawDocumentInput): Promise<void> {
  const payload = JSON.stringify(input.payload);
  await db.runAsync(
    'insert into raw_documents (endpoint, payload, fetched_at, content_hash) values (?, ?, ?, ?) on conflict (endpoint, content_hash) do nothing',
    [input.endpoint, payload, input.fetchedAt, createHash('sha256').update(payload).digest('hex')],
  );
}

/** Books a release page attempt as the code at store version 6 did, before migration 7 marked phone bookings. */
async function bookAtVersion6(db: SQLiteDatabase, key: ReleaseKey, outcome: 'dated' | 'undated', at: Date): Promise<void> {
  await db.runAsync(
    `insert into release_page_attempts (item_type, item_id, attempted_at, outcome, failures) values (?, ?, ?, ?, 0)
     on conflict (item_type, item_id) do update set attempted_at = excluded.attempted_at, outcome = excluded.outcome, failures = 0`,
    [key.itemType, key.itemId, at.toISOString(), outcome],
  );
}

const CRUMB = '|collect_item_cb|1727531042|q8Zc+Lm/2vXe0sPd9RkYbQ==';
const FETCHED_AT = '2026-09-28T14:00:00.000Z';

test('migration 3 deletes the feed pokes stored as HTML and leaves no crumb in the file', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'wavfeed-migrate-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, 'store.db');
  const { db, close } = await openTestStore(file);
  await heldAt(db, 2);
  const html = `<meta id="js-crumbs-data" data-crumbs="{&quot;collect_item_cb&quot;:&quot;${CRUMB}&quot;}">`;
  const url = 'https://bandcamp.com/ellie/feed';
  await insertLegacyRaw(db, { endpoint: 'fan_feed_page', payload: { url, html }, fetchedAt: FETCHED_AT });
  const feed = feedPayload({ entries: [] });
  await insertLegacyRaw(db, { endpoint: 'fan_dash_feed_updates', payload: feed, fetchedAt: FETCHED_AT });

  await migrate(db);

  const left = await db.getAllAsync<{ endpoint: string }>('select endpoint from raw_documents order by id');
  assert.deepEqual(left.map((row) => row.endpoint), ['fan_dash_feed_updates']);
  close();
  assert.ok(!readFileSync(file).includes(CRUMB));
});

test('migration 4 adds the Tally outbox to a store at version 3, whose rows are a Tally or an Error Report', async () => {
  const { db } = await openTestStore();
  await heldAt(db, 3);
  await insertLegacyRaw(db, { endpoint: 'fan_dash_feed_updates', payload: feedPayload({ entries: [] }), fetchedAt: FETCHED_AT });

  assert.equal(await migrate(db), 11);

  await db.runAsync("insert into tally_outbox (kind, body, created_at) values ('tally', '[]', 1)");
  await assert.rejects(db.runAsync("insert into tally_outbox (kind, body, created_at) values ('note', '[]', 1)"), /CHECK/);
  assert.equal((await db.getFirstAsync<{ n: number }>('select count(*) as n from raw_documents'))?.n, 1);
});

test('migration 5 and the replay it comes with put a pre-order the feed dated back on the Upcoming shelf', async () => {
  const { db, close } = await openTestStore();
  const now = new Date(Date.UTC(2026, 8, 29, 12, 0, 0));
  const other = PREORDER_ITEM_ID + 1;
  const otherUrl = 'https://nightgraft.bandcamp.com/album/lantern-weeks';
  const announced = (collected: number) =>
    feedPayload({
      entries: [
        preorderNrEntry({ also_collected_count: collected }),
        preorderNrEntry({ item_id: other, album_id: other, item_title: 'Lantern Weeks', item_url: otherUrl }),
      ],
    });
  // The store as a device held it at migration 4 and Projection version 2: the feed read, the player's read of one
  // page, the feed read again, and both Releases dated by the moment their pages went public.
  await heldAt(db, 4);
  const page = releasePagePayload({ itemId: PREORDER_ITEM_ID, itemUrl: PREORDER_URL, tralbum: preorderTralbumBlob() });
  const reads = [
    { endpoint: FEED_UPDATES_ENDPOINT, payload: announced(3), fetchedAt: '2026-09-29T10:00:00.000Z' },
    { endpoint: RELEASE_PAGE_ENDPOINT, payload: page, fetchedAt: '2026-09-29T10:05:00.000Z' },
    { endpoint: FEED_UPDATES_ENDPOINT, payload: announced(4), fetchedAt: '2026-09-29T11:00:00.000Z' },
  ];
  for (const read of reads) await insertLegacyRaw(db, read);
  await db.execAsync(`
    insert into pages (band_id, name, url, first_seen_at, last_seen_at)
      values (${BAND_ID}, 'Nightgraft Recordings', 'https://nightgraft.bandcamp.com', '2026-09-29T10:00:00.000Z', '2026-09-29T11:00:00.000Z');
    insert into releases (item_type, item_id, band_id, title, url, release_date, num_streamable_tracks, is_preorder, first_seen_at, last_seen_at)
      values ('a', ${PREORDER_ITEM_ID}, ${BAND_ID}, 'Moth Season', '${PREORDER_URL}', '2026-09-29T09:12:40.000Z', 1, 1, '2026-09-29T10:00:00.000Z', '2026-09-29T11:00:00.000Z'),
             ('a', ${other}, ${BAND_ID}, 'Lantern Weeks', '${otherUrl}', '2026-09-29T09:12:40.000Z', 1, 1, '2026-09-29T10:00:00.000Z', '2026-09-29T11:00:00.000Z');
    insert into stories (story_type, fan_key, item_type, item_id, story_date, raw_document_id)
      values ('new_release', 0, 'a', ${PREORDER_ITEM_ID}, '2026-09-29T09:12:40.000Z', 3), ('new_release', 0, 'a', ${other}, '2026-09-29T09:12:40.000Z', 3);
    insert into projection_progress (endpoint, last_raw_id) values ('${FEED_UPDATES_ENDPOINT}', 3), ('${RELEASE_PAGE_ENDPOINT}', 2);
    insert into kv (key, value) values ('${PROJECTION_VERSION_KEY}', '2');
  `);

  await migrate(db);
  assert.equal(await ensureProjectionVersion(db), true);

  // The Releases' own rows; their Drops are rows of their own.
  const inWeeks = async () =>
    (await readNewReleases(db, { now })).weeks.flatMap((week) =>
      week.releases.flatMap((placed) => (placed.kind === 'release' ? [Number(placed.release.itemId)] : [])),
    );
  const shelf = async () => (await listUpcomingReleases(db, now)).map((r) => [r.itemId, r.releaseDate.toISOString(), r.numTracks]);
  assert.deepEqual(await shelf(), [[PREORDER_ITEM_ID, '2026-10-13T00:00:00.000Z', 4]]);
  assert.deepEqual(await inWeeks(), [], 'the one with no page held waits, undated and out of the weeks, for its page');
  assert.deepEqual(await readUndatedReleases(db, 10, now), [{ itemType: 'a', itemId: other, url: otherUrl }]);

  // The next gather reads the other page, as it reads any undated Release's.
  const otherPage = preorderTralbumBlob({ id: other, current: { id: other, type: 'album', release_date: '20 Oct 2026 00:00:00 GMT' } });
  const otherRead = releasePagePayload({ itemId: other, itemUrl: otherUrl, tralbum: otherPage });
  await insertRawDocument(db, { endpoint: RELEASE_PAGE_ENDPOINT, payload: otherRead, fetchedAt: '2026-09-29T12:00:00.000Z' });
  await fold(db);
  assert.deepEqual(await shelf(), [
    [PREORDER_ITEM_ID, '2026-10-13T00:00:00.000Z', 4],
    [other, '2026-10-20T00:00:00.000Z', 4],
  ]);
  assert.deepEqual(await inWeeks(), []);
  close();
});

test("migration 7 makes an Upcoming page and a Drop's Track page read as a phone due once more", async () => {
  const { db, close } = await openTestStore();
  const album: ReleaseKey = { itemType: 'a', itemId: PREORDER_ITEM_ID };
  const track: ReleaseKey = { itemType: 't', itemId: preorderTrackId(3) };
  const albumRead = (tralbum: unknown): unknown => releasePagePayload({ itemId: PREORDER_ITEM_ID, itemUrl: PREORDER_URL, tralbum });
  const trackRead = (tralbum: unknown): unknown =>
    releasePagePayload({ itemType: 't', itemId: track.itemId, itemUrl: 'https://nightgraft.bandcamp.com/track/wing-dust', tralbum });
  let migrated = false;
  const read = async (payload: unknown, fetchedAt: string, key: ReleaseKey, outcome: 'dated' | 'undated') => {
    const doc: RawDocumentInput = { endpoint: RELEASE_PAGE_ENDPOINT, payload, fetchedAt };
    await insertRawDocument(db, doc);
    const at = new Date(Date.parse(fetchedAt) + 1000);
    await (migrated ? markReleasePageAttempt(db, key, outcome, at) : bookAtVersion6(db, key, outcome, at));
    await fold(db);
  };
  // A Track page as a phone is served it: `current` has no `mod_date`.
  const { mod_date: _dropped, ...phoneCurrent } = preorderTrackPageBlob(3, '').current as Record<string, unknown>;
  const phoneTrackPage = { ...preorderTrackPageBlob(3, ''), current: phoneCurrent };

  // The store as the phone held it at migration 6: the pre-order announced with one Track out, then read on 5 October
  // with a second out, a Drop dated by that read, and the Track page that could not date it.
  await insertRawDocument(db, {
    endpoint: FEED_UPDATES_ENDPOINT,
    payload: feedPayload({ entries: [preorderNrEntry()] }),
    fetchedAt: '2026-09-29T10:00:00.000Z',
  });
  await fold(db);
  await read(albumRead(phonePreorderTralbumBlob([2])), '2026-09-29T10:05:00.000Z', album, 'dated');
  await read(albumRead(phonePreorderTralbumBlob([2, 3])), '2026-10-05T09:10:00.000Z', album, 'dated');
  await read(trackRead(phoneTrackPage), '2026-10-05T09:11:00.000Z', track, 'undated');
  const days = async () => (await listDrops(db)).map((drop) => drop.day);
  assert.deepEqual(await days(), ['2026-10-05', '2026-09-29']);

  await heldAt(db, 6);
  await migrate(db);
  migrated = true;
  const due = async (iso: string) => ({
    upcoming: (await readUpcomingDue(db, 10, new Date(iso))).map((r) => r.itemId),
    owed: (await readOwedTrackPages(db, 10, new Date(iso))).map((r) => r.itemId),
  });
  assert.deepEqual(await due('2026-10-05T10:00:00.000Z'), { upcoming: [PREORDER_ITEM_ID], owed: [track.itemId] });

  // The same pages asked for as a desktop browser: the Track page's `mod_date` dates the Drop inside its window.
  await read(trackRead(preorderTrackPageBlob(3, '03 Oct 2026 17:02:11 GMT')), '2026-10-05T10:01:00.000Z', track, 'dated');
  await read(albumRead(preorderTralbumBlob({}, [2, 3])), '2026-10-05T10:02:00.000Z', album, 'dated');
  assert.deepEqual(await days(), ['2026-10-03', '2026-09-29']);
  assert.deepEqual(await due('2026-10-05T10:03:00.000Z'), { upcoming: [], owed: [] });
  assert.deepEqual(await due('2026-10-06T10:02:01.000Z'), { upcoming: [PREORDER_ITEM_ID], owed: [] }, 'then a day old, as any');
  close();
});

test('migration 7 on a store whose clock ran ahead makes a page due once, not until the clock catches up', async () => {
  const { db, close } = await openTestStore();
  const album: ReleaseKey = { itemType: 'a', itemId: PREORDER_ITEM_ID };
  let migrated = false;
  const read = async (tralbum: unknown, fetchedAt: string) => {
    const payload = releasePagePayload({ itemId: PREORDER_ITEM_ID, itemUrl: PREORDER_URL, tralbum });
    await insertRawDocument(db, { endpoint: RELEASE_PAGE_ENDPOINT, payload, fetchedAt });
    const at = new Date(Date.parse(fetchedAt) + 1000);
    await (migrated ? markReleasePageAttempt(db, album, 'dated', at) : bookAtVersion6(db, album, 'dated', at));
    await fold(db);
  };
  const due = async (iso: string) => (await readUpcomingDue(db, 10, new Date(iso))).map((r) => r.itemId);

  // The phone read the page as a phone on 1 October with its clock a week fast, then the clock was put right.
  await insertRawDocument(db, {
    endpoint: FEED_UPDATES_ENDPOINT,
    payload: feedPayload({ entries: [preorderNrEntry()] }),
    fetchedAt: '2026-09-29T10:00:00.000Z',
  });
  await fold(db);
  await read(phonePreorderTralbumBlob([2]), '2026-10-08T10:05:00.000Z');

  await heldAt(db, 6);
  await migrate(db);
  migrated = true;
  assert.deepEqual(await due('2026-10-01T10:00:00.000Z'), [PREORDER_ITEM_ID]);
  await read(preorderTralbumBlob({}, [2]), '2026-10-01T10:01:00.000Z');
  assert.deepEqual(await due('2026-10-01T10:03:00.000Z'), []);
  assert.deepEqual(await due('2026-10-04T10:03:00.000Z'), []);
  close();
});

test('migration 9 and the replay it comes with put the album of a Track bought alone on the shelf in its place', async () => {
  const { db, close } = await openTestStore();
  const now = new Date(Date.UTC(2026, 9, 3, 12));
  const track = preorderTrackId(2);
  await insertRawDocument(db, {
    endpoint: FEED_UPDATES_ENDPOINT,
    payload: feedPayload({ entries: [preorderTrackPurchase(2)] }),
    fetchedAt: '2026-10-02T21:09:00.000Z',
  });
  await insertRawDocument(db, {
    endpoint: RELEASE_PAGE_ENDPOINT,
    payload: releasePagePayload({ itemType: 't', itemId: track, itemUrl: 'https://nightgraft.bandcamp.com/track/lamp-glass', tralbum: preorderTrackPageBlob(2, '29 Sep 2026 09:12:40 GMT') }),
    fetchedAt: '2026-10-02T23:21:00.000Z',
  });
  await fold(db);
  // The store as a device held it at migration 8 and Projection version 5, whose fold opened no album.
  await db.execAsync(`delete from releases where item_type = 'a'; insert or replace into kv (key, value) values ('${PROJECTION_VERSION_KEY}', '5');`);
  await heldAt(db, 8);
  const shelf = async () => (await listUpcomingReleases(db, now)).map((release) => [release.itemType, release.itemId]);
  await migrate(db);
  // Migrated and not yet replayed, the shelf reads what the device held.
  assert.deepEqual(await shelf(), [['t', track]]);

  assert.equal(await ensureProjectionVersion(db), true);

  assert.deepEqual(await shelf(), [['a', PREORDER_ITEM_ID]]);
  close();
});

test('migration 11 and the replay it comes with credit the artist a held feed page names, apart from its Page', async (t) => {
  const { db, close } = await openTestStore();
  t.after(close);
  const now = new Date(Date.UTC(2026, 7, 20, 12));
  await insertRawDocument(db, {
    endpoint: FEED_UPDATES_ENDPOINT,
    payload: feedPayload({ entries: [nrEntry({ band_name: 'Jay Mitta' })] }),
    fetchedAt: '2026-08-18T08:00:00.000Z',
  });
  await fold(db);
  // The store as a device held it at migration 10 and Projection version 7, which kept no credit.
  await heldAt(db, 10);
  await db.runAsync('insert or replace into kv (key, value) values (?, ?)', [PROJECTION_VERSION_KEY, '7']);

  await migrate(db);
  assert.equal(await ensureProjectionVersion(db), true);

  const names = (await readNewReleases(db, { now })).weeks.flatMap((week) => week.releases.map(({ release }) => [release.pageName, release.artistCredit]));
  assert.deepEqual(names, [['Nightgraft Recordings', 'Jay Mitta']]);
});

test('a store a newer bundle migrated past the code opens as it is, reported as schema_newer', async () => {
  const { db, close } = await openTestStore();
  await turnSharingOn(db, '3b9f0c52-8a0e-4c2f-9a41-6f1d2b7e9c10', Date.now());
  errorReports.setSink(db);
  await db.execAsync("create table later (x); insert into schema_migrations (version, applied_at) values (99, '2026-10-01')");

  assert.equal(await migrate(db), 11);

  assert.ok(await db.getFirstAsync("select name from sqlite_master where name = 'later'"));
  const rows = await db.getAllAsync<{ body: string }>("select body from tally_outbox where kind = 'error'");
  assert.deepEqual(rows.map((row) => (JSON.parse(row.body) as ErrorReport).code), ['schema_newer']);
  errorReports.setSink(null);
  close();
});

test('migration 10 preserves gapped raw provenance and cursors, and admits older-bundle inserts after rollback', async (t) => {
  const { db, close } = await openTestStore();
  t.after(close);
  // Build the old projected state, then remove the additive schema before exercising its migration.
  const first = { endpoint: FEED_UPDATES_ENDPOINT, payload: feedPayload({ entries: [preorderNrEntry()] }), fetchedAt: FETCHED_AT };
  const held = await insertRawDocument(db, first);
  await fold(db);
  await heldAt(db, 9);
  await db.runAsync('update raw_documents set id = 3 where id = ?', [held.id]);
  await db.runAsync('update stories set raw_document_id = 3');
  await db.runAsync('update projection_progress set last_raw_id = 3');
  const later = { ...first, payload: feedPayload({ entries: [preorderNrEntry({ item_id: PREORDER_ITEM_ID + 1, album_id: PREORDER_ITEM_ID + 1 })] }) };
  await insertLegacyRaw(db, later);
  await db.runAsync('update raw_documents set id = 7 where id = 4');

  await migrate(db);

  assert.deepEqual(await countForProjection(db), { waiting: 1, held: 2 });
  const pending = await listForProjection(db, 10);
  assert.deepEqual(pending.map((doc) => [doc.id, doc.observationId, doc.fetchedAt]), [[7, 7, FETCHED_AT]]);
  await fold(db);
  assert.deepEqual((await db.getAllAsync<{ raw_document_id: number }>('select raw_document_id from stories order by raw_document_id')).map((row) => row.raw_document_id), [3, 7]);
  await insertLegacyRaw(db, { ...first, payload: feedPayload({ entries: [preorderNrEntry({ item_id: PREORDER_ITEM_ID + 2, album_id: PREORDER_ITEM_ID + 2 })] }) });
  const observed = await listForProjection(db, 10);
  assert.deepEqual(observed.map((doc) => [doc.id, doc.observationId]), [[8, 8]], 'the schema trigger observes the legacy writer');
  await fold(db);
  assert.equal((await db.getFirstAsync<{ n: number }>('select count(*) as n from stories'))?.n, 3);
});

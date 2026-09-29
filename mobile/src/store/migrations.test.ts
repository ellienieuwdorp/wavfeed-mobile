/// <reference types="node" />
/**
 * Migration 3 on a store that already holds feed pokes as HTML (ADR-0003, ADR-0004 amendment 2026-09-29): those rows
 * go, their crumbs with them down to the database file's bytes, and every other Raw Document stays. Migration 5 and the
 * replay after it on a store that filed a pre-order by its feed date: the Release is Upcoming again (task 0041, decision 2).
 */
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import type { SQLiteDatabase } from 'expo-sqlite';

import {
  BAND_ID,
  feedPayload,
  PREORDER_ITEM_ID,
  PREORDER_URL,
  preorderNrEntry,
  preorderTralbumBlob,
  releasePagePayload,
} from '../../test/fixtures';
import { openTestStore } from '../../test/nodeDb';
import { FEED_UPDATES_ENDPOINT, RELEASE_PAGE_ENDPOINT } from '../domain/endpoints';
import { readUndatedReleases } from './enrichment';
import { migrate } from './migrations';
import { ensureProjectionVersion, fold, PROJECTION_VERSION_KEY } from './projection';
import { listUpcomingReleases, readNewReleases } from './queries';
import { insertRawDocument } from './rawDocuments';

/** Undoes the migrations after `version`, so a test starts from the store a device held then. */
async function heldAt(db: SQLiteDatabase, version: number): Promise<void> {
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
  await insertRawDocument(db, { endpoint: 'fan_feed_page', payload: { url, html }, fetchedAt: FETCHED_AT });
  const feed = feedPayload({ entries: [] });
  await insertRawDocument(db, { endpoint: 'fan_dash_feed_updates', payload: feed, fetchedAt: FETCHED_AT });

  await migrate(db);

  const left = await db.getAllAsync<{ endpoint: string }>('select endpoint from raw_documents order by id');
  assert.deepEqual(left.map((row) => row.endpoint), ['fan_dash_feed_updates']);
  close();
  assert.ok(!readFileSync(file).includes(CRUMB));
});

test('migration 4 adds the Tally outbox to a store at version 3, whose rows are a Tally or an Error Report', async () => {
  const { db } = await openTestStore();
  await heldAt(db, 3);
  await insertRawDocument(db, { endpoint: 'fan_dash_feed_updates', payload: feedPayload({ entries: [] }), fetchedAt: FETCHED_AT });

  assert.equal(await migrate(db), 6);

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
  for (const read of reads) await insertRawDocument(db, read);
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

  // The Releases' own rows; their Drops are rows of their own (task 0041, decision 10).
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

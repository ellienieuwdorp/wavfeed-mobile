/// <reference types="node" />
/** Catalog observations preserve reversions and replay without duplicating immutable bodies. */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { bandDetailsPayload, discographyItem, feedPayload, ITEM_ID, nrEntry, releasePagePayload } from '../../test/fixtures';
import { openTestStore } from '../../test/nodeDb';
import { BAND_DETAILS_ENDPOINT, FEED_UPDATES_ENDPOINT, RELEASE_PAGE_ENDPOINT } from '../domain/endpoints';
import { fold, rebuild } from './projection';
import { countForProjection, countRawDocuments, insertRawDocument, latestReleasePageDocument } from './rawDocuments';

const FIRST = '2026-10-10T12:00:00.000Z';
const CHANGED = '2026-10-11T12:00:00.000Z';
const RESTORED = '2026-10-12T12:00:00.000Z';
const A = '2026-10-13T00:00:00.000Z';
const B = '2026-11-13T00:00:00.000Z';

for (const endpoint of [BAND_DETAILS_ENDPOINT, RELEASE_PAGE_ENDPOINT]) {
  test(`${endpoint}: returning to an earlier date is a new observation and survives replay`, async (t) => {
    const { db, close } = await openTestStore();
    t.after(close);
    // Release pages enrich a Release already reached by a Story; the Sweep opens its own catalog row.
    if (endpoint === RELEASE_PAGE_ENDPOINT) {
      await insertRawDocument(db, { endpoint: FEED_UPDATES_ENDPOINT, payload: feedPayload({ entries: [nrEntry()] }), fetchedAt: FIRST });
      await fold(db);
    }
    const payload = (date: string) => endpoint === BAND_DETAILS_ENDPOINT
      ? bandDetailsPayload({ items: [discographyItem({ item_id: ITEM_ID, release_date: date })] })
      : releasePagePayload({ tralbum: { current: { id: ITEM_ID, type: 'album', release_date: date }, trackinfo: [] } });
    const original = payload(A);
    const first = await insertRawDocument(db, { endpoint, payload: original, fetchedAt: FIRST });
    await fold(db);
    await insertRawDocument(db, { endpoint, payload: payload(B), fetchedAt: CHANGED });
    await fold(db);
    const before = await countRawDocuments(db);
    await insertRawDocument(db, { endpoint, payload: original, fetchedAt: RESTORED });
    await fold(db);

    const held = () => db.getFirstAsync<{ release_date: string; release_date_read_at: string }>(
      'select release_date, release_date_read_at from releases where item_type = ? and item_id = ?', ['a', ITEM_ID],
    );
    assert.deepEqual({ ...await held() }, { release_date: A, release_date_read_at: RESTORED });
    assert.equal(await countRawDocuments(db), before, 'the existing verbatim body is reused');
    const raw = await db.getFirstAsync<{ payload: string; fetched_at: string }>('select payload, fetched_at from raw_documents where id = ?', [first.id]);
    assert.deepEqual({ ...raw }, { payload: JSON.stringify(original), fetched_at: FIRST }, 'the original Raw Document stays immutable');
    if (endpoint === RELEASE_PAGE_ENDPOINT) {
      assert.equal((await latestReleasePageDocument(db, 'a', ITEM_ID))?.fetchedAt, RESTORED);
    }
    await rebuild(db);
    assert.deepEqual({ ...await held() }, { release_date: A, release_date_read_at: RESTORED });
  });
}

test('an unchanged Page read stays deduped across another Page, while a known feed body still stops pagination', async (t) => {
  const { db, close } = await openTestStore();
  t.after(close);
  const page = bandDetailsPayload();
  await insertRawDocument(db, { endpoint: BAND_DETAILS_ENDPOINT, payload: page, fetchedAt: FIRST });
  await insertRawDocument(db, { endpoint: BAND_DETAILS_ENDPOINT, payload: bandDetailsPayload({ bandId: 999 }), fetchedAt: CHANGED });
  assert.equal((await insertRawDocument(db, { endpoint: BAND_DETAILS_ENDPOINT, payload: page, fetchedAt: RESTORED })).deduped, true);
  const feed = feedPayload({ entries: [nrEntry()] });
  await insertRawDocument(db, { endpoint: FEED_UPDATES_ENDPOINT, payload: feed, fetchedAt: FIRST });
  await insertRawDocument(db, { endpoint: FEED_UPDATES_ENDPOINT, payload: feedPayload({ entries: [] }), fetchedAt: CHANGED });
  assert.equal((await insertRawDocument(db, { endpoint: FEED_UPDATES_ENDPOINT, payload: feed, fetchedAt: RESTORED })).deduped, true);
});

test('concurrent confirmations on two connections record one catalog reversion', async (t) => {
  const dir = mkdtempSync(join('build', 'observations-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, 'store.db');
  const first = await openTestStore(file);
  const second = await openTestStore(file);
  t.after(() => { second.close(); first.close(); });
  const a = bandDetailsPayload({ items: [discographyItem({ item_id: ITEM_ID, release_date: A })] });
  const b = bandDetailsPayload({ items: [discographyItem({ item_id: ITEM_ID, release_date: B })] });
  await insertRawDocument(first.db, { endpoint: BAND_DETAILS_ENDPOINT, payload: a, fetchedAt: FIRST });
  await insertRawDocument(first.db, { endpoint: BAND_DETAILS_ENDPOINT, payload: b, fetchedAt: CHANGED });
  const confirmations = await Promise.all([first.db, second.db].map((db) =>
    insertRawDocument(db, { endpoint: BAND_DETAILS_ENDPOINT, payload: a, fetchedAt: RESTORED }),
  ));
  assert.deepEqual(confirmations.map((read) => read.deduped).sort((a, b) => Number(a) - Number(b)), [false, true]);
  assert.equal(await countRawDocuments(first.db), 2);
  assert.deepEqual(await countForProjection(first.db), { waiting: 3, held: 3 });
  await fold(first.db);
  assert.equal((await first.db.getFirstAsync<{ release_date: string }>('select release_date from releases where item_id = ?', [ITEM_ID]))?.release_date, A);
});

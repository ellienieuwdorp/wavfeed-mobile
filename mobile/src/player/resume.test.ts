/// <reference types="node" />
/**
 * The last-played Release a launch restores: what is saved reads back at the same Track and
 * position for the same Fan, and nothing reads back for another Fan, another version, a Release the store no longer
 * holds or whose page no longer reads; a position past a Track's end starts that Track over.
 */
import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';

import { writeKv } from '@/store/kv';
import { insertRawDocument } from '@/store/rawDocuments';

import { FAN_ID, ITEM_ID, OTHER_FAN_ID, releasePagePayload } from '../../test/fixtures';
import { openTestStore } from '../../test/nodeDb';
import { loadResume, RESUME_KEY, savedPlayback, savePlayback } from './resume';
import type { PlayableRelease } from './transport';

const RELEASE: PlayableRelease = {
  itemType: 'album',
  itemId: String(ITEM_ID),
  title: 'Slow Harbour',
  artist: 'Nightgraft',
  url: 'https://nightgraft.bandcamp.com/album/slow-harbour',
  artUrl: null,
  hue: 210,
  label: null,
};
/** The fixture page's second Track, 402.1 seconds; its third does not stream. */
const SECOND = '55501123';
const SILENT = '55501124';

async function store(t: TestContext, { row = true, page = true } = {}) {
  const { db, close } = await openTestStore();
  t.after(close);
  if (row) {
    await db.runAsync(
      `insert into releases (item_type, item_id, band_id, title, url, first_seen_at, last_seen_at)
       values ('a', ?, 1, 'Slow Harbour', ?, '2026-10-01', '2026-10-01')`,
      [ITEM_ID, RELEASE.url],
    );
  }
  if (page) await insertRawDocument(db, { endpoint: 'release_page', payload: releasePagePayload(), fetchedAt: '2026-10-15T09:00:00.000Z' });
  return db;
}

test('a saved Release reads back for its Fan at the same Track and position, with its stored tracklist', async (t) => {
  const db = await store(t);
  await savePlayback(db, savedPlayback(FAN_ID, RELEASE, SECOND, 123.456));
  const resume = await loadResume(db, FAN_ID);
  assert.deepEqual(resume?.release, RELEASE);
  assert.equal(resume?.index, 1);
  assert.equal(resume?.tracklist.tracks[1]?.trackId, SECOND);
  assert.equal(resume?.position, 123.5);
});

test('a Release saved at rest after its last Track reads back at rest', async (t) => {
  const db = await store(t);
  await savePlayback(db, savedPlayback(FAN_ID, RELEASE, null, 300));
  const resume = await loadResume(db, FAN_ID);
  assert.equal(resume?.index, null);
  assert.equal(resume?.position, 0);
});

test("nothing reads back for no Fan, another Fan's save, another version or a shape this build does not know", async (t) => {
  const db = await store(t);
  await savePlayback(db, savedPlayback(FAN_ID, RELEASE, SECOND, 40));
  assert.equal(await loadResume(db, null), null);
  assert.equal(await loadResume(db, OTHER_FAN_ID), null);
  await writeKv(db, RESUME_KEY, { ...savedPlayback(FAN_ID, RELEASE, SECOND, 40), v: 2 });
  assert.equal(await loadResume(db, FAN_ID), null);
  await writeKv(db, RESUME_KEY, { ...savedPlayback(FAN_ID, RELEASE, SECOND, 40), release: { ...RELEASE, itemType: 'merch' } });
  assert.equal(await loadResume(db, FAN_ID), null);
  await db.runAsync('update kv set value = ? where key = ?', ['{not json', RESUME_KEY]);
  assert.equal(await loadResume(db, FAN_ID), null);
});

test('a Release the store no longer holds, or whose page it never stored, restores nothing', async (t) => {
  for (const held of [{ row: false }, { page: false }]) {
    const db = await store(t, held);
    await savePlayback(db, savedPlayback(FAN_ID, RELEASE, SECOND, 40));
    assert.equal(await loadResume(db, FAN_ID), null, JSON.stringify(held));
  }
});

test('a saved Track that no longer streams resumes the first that does, from its start', async (t) => {
  const db = await store(t);
  for (const trackId of [SILENT, '99999999']) {
    await savePlayback(db, savedPlayback(FAN_ID, RELEASE, trackId, 40));
    const resume = await loadResume(db, FAN_ID);
    assert.deepEqual([resume?.index, resume?.position], [0, 0], trackId);
  }
});

test('a position before the start, unreadable, or within two seconds of the end starts the Track over', async (t) => {
  const saved = [-3, Number.NaN, 97.94, 500].map((position) => savedPlayback(FAN_ID, RELEASE, SECOND, position).position);
  assert.deepEqual(saved, [0, 0, 97.9, 500]);
  const db = await store(t);
  const restored: number[] = [];
  for (const position of [400, 400.2, 401, 430]) {
    await savePlayback(db, savedPlayback(FAN_ID, RELEASE, SECOND, position));
    restored.push((await loadResume(db, FAN_ID))?.position ?? Number.NaN);
  }
  assert.deepEqual(restored, [400, 0, 0, 0]);
});

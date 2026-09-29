/// <reference types="node" />
/**
 * Migration 3 on a store that already holds feed pokes as HTML (ADR-0003, ADR-0004 amendment 2026-09-29): those rows
 * go, their crumbs with them down to the database file's bytes, and every other Raw Document stays.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { feedPayload } from '../../test/fixtures';
import { openTestStore } from '../../test/nodeDb';
import { migrate } from './migrations';
import { insertRawDocument } from './rawDocuments';

const CRUMB = '|collect_item_cb|1727531042|q8Zc+Lm/2vXe0sPd9RkYbQ==';
const FETCHED_AT = '2026-09-28T14:00:00.000Z';

test('migration 3 deletes the feed pokes stored as HTML and leaves no crumb in the file', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'wavfeed-migrate-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, 'store.db');
  const { db, close } = await openTestStore(file);
  // The store as a device held it at version 2.
  await db.execAsync('drop table tally_outbox; delete from schema_migrations where version >= 3;');
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
  // The store as a device held it at version 3.
  await db.execAsync('drop table tally_outbox; delete from schema_migrations where version = 4;');
  await insertRawDocument(db, { endpoint: 'fan_dash_feed_updates', payload: feedPayload({ entries: [] }), fetchedAt: FETCHED_AT });

  assert.equal(await migrate(db), 4);

  await db.runAsync("insert into tally_outbox (kind, body, created_at) values ('tally', '[]', 1)");
  await assert.rejects(db.runAsync("insert into tally_outbox (kind, body, created_at) values ('note', '[]', 1)"), /CHECK/);
  assert.equal((await db.getFirstAsync<{ n: number }>('select count(*) as n from raw_documents'))?.n, 1);
});

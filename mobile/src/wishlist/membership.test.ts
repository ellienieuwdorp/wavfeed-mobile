/// <reference types="node" />
/**
 * The hearts' shared membership (finding TECH-M1) on the real store: one read of `wishlist_items` however many hearts
 * ask for a version, a press that wins over a read already under way, and a failed read that the next ask retries.
 */
import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import type { SQLiteDatabase } from 'expo-sqlite';

import { openTestStore } from '../../test/nodeDb';
import { keyOf, loadMembership, membershipOf, patchMembership } from './membership';

const KEY = keyOf('a', '1001');
const OTHER = keyOf('a', '2002');

async function storeWith(itemIds: readonly number[]): Promise<{ db: SQLiteDatabase; reads: () => number }> {
  const { db } = await openTestStore();
  for (const itemId of itemIds) {
    await db.runAsync('insert into wishlist_items (item_type, item_id, band_id, added_at, last_seen_snapshot_at) values (?, ?, ?, ?, ?)', [
      'a',
      itemId,
      7,
      '2026-10-01T00:00:00Z',
      '2026-10-01T00:00:00Z',
    ]);
  }
  const read = mock.method(db, 'getAllAsync');
  return { db, reads: () => read.mock.callCount() };
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

test('a version every mounted heart asks for is read once', async () => {
  const { db, reads } = await storeWith([1001]);
  assert.equal(membershipOf(db, KEY), 'unknown');
  for (let heart = 0; heart < 100; heart += 1) loadMembership(db, 1);
  await settle();
  for (let heart = 0; heart < 100; heart += 1) loadMembership(db, 1);
  assert.equal(reads(), 1);
  assert.deepEqual([membershipOf(db, KEY), membershipOf(db, OTHER)], ['on', 'off']);
});

test('a newer version asked while a read is under way reads again, an older one does not', async () => {
  const { db, reads } = await storeWith([]);
  loadMembership(db, 2);
  loadMembership(db, 1);
  loadMembership(db, 3);
  await settle();
  loadMembership(db, 3);
  assert.equal(reads(), 2);
});

test('a press lands at once and a read that started before it cannot undo it', async () => {
  const { db } = await storeWith([1001]);
  loadMembership(db, 1);
  await settle();
  loadMembership(db, 2);
  await db.runAsync('delete from wishlist_items where item_id = 1001');
  patchMembership(KEY, false);
  assert.equal(membershipOf(db, KEY), 'off');
  await settle();
  assert.equal(membershipOf(db, KEY), 'off');
});

test('a read that fails leaves the version to be asked again', async () => {
  const { db } = await storeWith([1001]);
  const read = mock.method(db, 'getAllAsync', async () => {
    throw new Error('store closed');
  });
  loadMembership(db, 1);
  await settle();
  read.mock.restore();
  loadMembership(db, 1);
  await settle();
  assert.equal(membershipOf(db, KEY), 'on');
});

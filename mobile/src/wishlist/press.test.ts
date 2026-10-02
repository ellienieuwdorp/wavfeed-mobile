/// <reference types="node" />
/**
 * Last tap wins (ADR-0016 amendment 2026-10-02) on the real store: a press shows at once, taps while an exchange
 * travels send nothing of their own, a landed exchange is followed by one more only when the last tap moved away from
 * it, and a failure tells the Fan only when the heart, back on the truth, is not what they last pressed for.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { SQLiteDatabase } from 'expo-sqlite';

import { openTestStore } from '../../test/nodeDb';
import { intentOf, keyOf, loadMembership, membershipOf, shownOf } from './membership';
import { pressItem, type Tell, type Travel } from './press';

const KEY = keyOf('a', '1001');
const settle = () => new Promise((resolve) => setImmediate(resolve));

type Exchange = { readonly on: boolean; readonly answer: (tell: Tell | null) => void };

/** A store whose wishlist is empty, read into the shared set, and a Travel whose exchanges wait to be answered. */
async function offHeart(): Promise<{ db: SQLiteDatabase; travel: Travel; sent: Exchange[] }> {
  const { db } = await openTestStore();
  loadMembership(db, 1);
  await settle();
  const sent: Exchange[] = [];
  const travel: Travel = {
    db,
    send: (on) => new Promise((resolve) => sent.push({ on, answer: resolve })),
    saved: () => undefined,
  };
  return { db, travel, sent };
}

async function answer(exchange: Exchange | undefined, ok: boolean, onTell: Tell = () => undefined) {
  assert.ok(exchange !== undefined, 'an exchange was sent');
  exchange.answer(ok ? null : onTell);
  await settle();
}

test('a press shows at once, and a tap while it travels is sent after it lands', async () => {
  const { db, travel, sent } = await offHeart();
  pressItem(KEY, true, travel);
  assert.equal(shownOf(db, KEY), 'on');
  pressItem(KEY, false, travel);
  assert.equal(shownOf(db, KEY), 'off');
  assert.deepEqual(sent.map((e) => e.on), [true]);

  await answer(sent[0], true);
  assert.deepEqual(sent.map((e) => e.on), [true, false]);
  assert.equal(membershipOf(db, KEY), 'on');
  assert.equal(shownOf(db, KEY), 'off');

  await answer(sent[1], true);
  assert.deepEqual([membershipOf(db, KEY), shownOf(db, KEY), intentOf(KEY)], ['off', 'off', null]);
});

test('taps that come back to what is travelling send nothing more', async () => {
  const { db, travel, sent } = await offHeart();
  pressItem(KEY, true, travel);
  pressItem(KEY, false, travel);
  pressItem(KEY, true, travel);
  await answer(sent[0], true);
  assert.equal(sent.length, 1);
  assert.deepEqual([membershipOf(db, KEY), shownOf(db, KEY), intentOf(KEY)], ['on', 'on', null]);
});

test('a failure the last tap already undid is quiet', async () => {
  const { db, travel, sent } = await offHeart();
  let told = 0;
  pressItem(KEY, true, travel);
  pressItem(KEY, false, travel);
  await answer(sent[0], false, () => (told += 1));
  assert.equal(told, 0);
  assert.equal(sent.length, 1);
  assert.deepEqual([shownOf(db, KEY), intentOf(KEY)], ['off', null]);
});

test('a failure the Fan still wants otherwise puts the truth back and tells once', async () => {
  const { db, travel, sent } = await offHeart();
  let told = 0;
  pressItem(KEY, true, travel);
  pressItem(KEY, false, travel);
  pressItem(KEY, true, travel);
  await answer(sent[0], false, () => (told += 1));
  assert.equal(told, 1);
  assert.equal(sent.length, 1);
  assert.deepEqual([shownOf(db, KEY), intentOf(KEY)], ['off', null]);

  pressItem(KEY, true, travel);
  assert.equal(sent.length, 2, 'the next press starts its own exchange');
  await answer(sent[1], true);
});

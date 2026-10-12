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
import { emptyStore } from '../store/schema';
import { beginWishlist, intentOf, keyOf, loadMembership, membershipOf, retireWishlist, shownOf } from './membership';
import { pressItem, type Tell, type Travel } from './press';

const KEY = keyOf('a', '1001');
const settle = () => new Promise((resolve) => setImmediate(resolve));

type Exchange = { readonly on: boolean; readonly answer: (tell: Tell | null) => void };

/** A store whose wishlist is empty, read into the shared set, and a Travel whose exchanges wait to be answered. */
async function offHeart(reused?: SQLiteDatabase): Promise<{ db: SQLiteDatabase; travel: Travel; sent: Exchange[] }> {
  const db = reused ?? (await openTestStore()).db;
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
  assert.deepEqual([membershipOf(db, KEY), shownOf(db, KEY), intentOf(db, KEY)], ['off', 'off', null]);
});

test('taps that come back to what is travelling send nothing more', async () => {
  const { db, travel, sent } = await offHeart();
  pressItem(KEY, true, travel);
  pressItem(KEY, false, travel);
  pressItem(KEY, true, travel);
  await answer(sent[0], true);
  assert.equal(sent.length, 1);
  assert.deepEqual([membershipOf(db, KEY), shownOf(db, KEY), intentOf(db, KEY)], ['on', 'on', null]);
});

test('a failure the last tap already undid is quiet', async () => {
  const { db, travel, sent } = await offHeart();
  let told = 0;
  pressItem(KEY, true, travel);
  pressItem(KEY, false, travel);
  await answer(sent[0], false, () => (told += 1));
  assert.equal(told, 0);
  assert.equal(sent.length, 1);
  assert.deepEqual([shownOf(db, KEY), intentOf(db, KEY)], ['off', null]);
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
  assert.deepEqual([shownOf(db, KEY), intentOf(db, KEY)], ['off', null]);

  pressItem(KEY, true, travel);
  assert.equal(sent.length, 2, 'the next press starts its own exchange');
  await answer(sent[1], true);
});

test('a press belongs to its store while another store loads and presses the same item', async () => {
  const old = await offHeart();
  pressItem(KEY, true, old.travel);
  const current = await offHeart();
  const shownBeforePress = shownOf(current.db, KEY);
  pressItem(KEY, true, current.travel);
  const currentSentAtPress = current.sent.length;
  await answer(old.sent[0], false);
  if (current.sent[0] !== undefined) await answer(current.sent[0], true);
  assert.equal(shownBeforePress, 'off', 'an old store intent must not be drawn in a new store');
  assert.equal(currentSentAtPress, 1, 'the new store must send its own press');
  assert.equal(membershipOf(current.db, KEY), 'on', 'the new store exchange owns its confirmation');
});

for (const sameDatabase of [false, true]) {
  for (const ok of [false, true]) {
    test(`a retired ${ok ? 'successful' : 'failed'} exchange cannot affect a new press on ${sameDatabase ? 'the same' : 'another'} database`, async () => {
      const old = await offHeart();
      let saved = 0;
      let told = 0;
      const travel = { ...old.travel, saved: () => { saved += 1; } };
      pressItem(KEY, true, travel);
      pressItem(KEY, false, travel);
      await retireWishlist(old.db);
      assert.equal(pressItem(KEY, true, travel), false, 'a retired owner refuses new presses');
      if (sameDatabase) {
        await emptyStore(old.db);
        beginWishlist(old.db);
      }
      const current = await offHeart(sameDatabase ? old.db : undefined);
      assert.equal(shownOf(current.db, KEY), 'off', 'retirement takes the old intent');
      assert.equal(pressItem(KEY, true, current.travel), true);
      await answer(old.sent[0], ok, () => { told += 1; });
      assert.deepEqual(old.sent.map((exchange) => exchange.on), [true], 'retirement cancels the queued remove');
      assert.deepEqual(current.sent.map((exchange) => exchange.on), [true], 'the new press sends independently');
      assert.equal(saved, 0, 'the old completion does not invalidate the new store');
      assert.equal(told, 0, 'the old failure does not raise a notice');
      assert.equal(membershipOf(current.db, KEY), 'off', 'an old confirmation cannot patch the new truth');
      assert.equal(intentOf(current.db, KEY), true, 'the old completion cannot clear the new press');
      await answer(current.sent[0], true);
      assert.equal(membershipOf(current.db, KEY), 'on');
      assert.equal(intentOf(current.db, KEY), null);
    });
  }
}

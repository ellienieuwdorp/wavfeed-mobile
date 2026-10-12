/// <reference types="node" />
/**
 * The row menu as a screen reader's actions, the heart's state the iOS row says (VIS-9, FLOW-13), and the whole row as
 * its label says it once the heart and the actor sentence left the drawn row (task 0071, decisions 12, 13 and 16).
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { copy } from '../copy';
import { heardRow, heardWishlist, PLAY_ACTION, spokenActions, type RowAction } from './rowActions';

function menu(ran: string[], enabled: Partial<Record<string, boolean>> = {}): RowAction[] {
  const item = (key: string, label: string): RowAction => ({ key, label, enabled: enabled[key] ?? true, run: () => ran.push(key) });
  return [item(PLAY_ACTION, copy.rowMenu.play), item('wishlist', copy.rowMenu.add), item('open', copy.rowMenu.open), item('share', copy.rowMenu.share)];
}

const act = (actionName: string) => ({ nativeEvent: { actionName } });

test('every item that takes a press is offered under its menu label, play left to the activation, Bought by last', () => {
  const opened: (readonly string[])[] = [];
  const spoken = spokenActions(menu([]), ['ana', 'bo'], (fans) => opened.push(fans));
  assert.deepEqual(spoken.accessibilityActions, [
    { name: 'wishlist', label: copy.rowMenu.add },
    { name: 'open', label: copy.rowMenu.open },
    { name: 'share', label: copy.rowMenu.share },
    { name: 'bought_by', label: copy.boughtBy.title },
  ]);
  spoken.onAccessibilityAction(act('bought_by'));
  assert.deepEqual(opened, [['ana', 'bo']]);
});

test('a row that names nobody offers no Bought by', () => {
  const spoken = spokenActions(menu([]), [], () => assert.fail('nobody to open'));
  assert.deepEqual(
    spoken.accessibilityActions.map((a) => a.name),
    ['wishlist', 'open', 'share'],
  );
  spoken.onAccessibilityAction(act('bought_by'));
});

test('an action runs its own item, and a greyed item is neither offered nor run', () => {
  const ran: string[] = [];
  const spoken = spokenActions(menu(ran, { wishlist: false, open: false }), [], () => undefined);
  assert.deepEqual(
    spoken.accessibilityActions.map((a) => a.name),
    ['share'],
  );
  for (const name of ['share', 'wishlist', 'open', PLAY_ACTION, 'activate']) spoken.onAccessibilityAction(act(name));
  assert.deepEqual(ran, ['share']);
});

test('the iOS row says the heart it hides when on, and nothing when off or not asked yet', () => {
  const cases = [
    [{ known: false }, null],
    [{ known: true, on: false }, null],
    [{ known: true, on: true }, copy.heart.on],
  ] as const;
  for (const [membership, heard] of cases) assert.equal(heardWishlist(membership), heard);
});

test('the spoken row says every line the row draws, the faces as who bought it and the wishlist the heart no longer shows', () => {
  const fan = (username: string) => ({ fanId: username, username, name: null, imageId: null });
  const drop = {
    title: 'Lantern Weather',
    credit: { artist: 'Tidal Machines', extra: 'Northbound Audio' },
    day: 'out Fri 16 Oct',
    count: '2 of 6 tracks',
    buyers: [fan('ana'), fan('bo')],
  };
  assert.equal(
    heardRow(drop, { known: true, on: true }, false),
    'Play Lantern Weather by Tidal Machines, Northbound Audio, out Fri 16 Oct, 2 of 6 tracks, bought by ana and 1 other, on your Bandcamp wishlist',
  );
  const plain = { title: 'Paper Moons', credit: { artist: 'Northern Signal', extra: null }, day: 'Mon 5', count: null, buyers: [] };
  assert.equal(heardRow(plain, { known: false }, true), 'Pause Paper Moons by Northern Signal, Mon 5');
});

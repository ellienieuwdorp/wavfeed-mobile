/// <reference types="node" />
/** The row menu as a screen reader's actions (VIS-9, FLOW-13). */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { copy } from '../copy';
import { PLAY_ACTION, spokenActions, type RowAction } from './rowActions';

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

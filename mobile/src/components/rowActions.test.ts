/// <reference types="node" />
/** The row menu as a screen reader's actions (VIS-9, FLOW-13). */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { copy } from '../copy';
import { spokenActions, type RowAction } from './rowActions';

function menu(ran: string[], enabled: Partial<Record<string, boolean>> = {}): RowAction[] {
  const item = (key: string, label: string): RowAction => ({ key, label, enabled: enabled[key] ?? true, run: () => ran.push(key) });
  return [
    item('play', copy.rowMenu.play),
    item('wishlist', copy.rowMenu.add),
    item('open', copy.rowMenu.open),
    item('share', copy.rowMenu.share),
    item('bought_by', copy.boughtBy.title),
  ];
}

const act = (actionName: string) => ({ nativeEvent: { actionName } });

test('every item that takes a press is offered under its menu label, play left to the activation', () => {
  const spoken = spokenActions(menu([]));
  assert.deepEqual(spoken.accessibilityActions, [
    { name: 'wishlist', label: copy.rowMenu.add },
    { name: 'open', label: copy.rowMenu.open },
    { name: 'share', label: copy.rowMenu.share },
    { name: 'bought_by', label: copy.boughtBy.title },
  ]);
});

test('an action runs its own item, and a greyed item is neither offered nor run', () => {
  const ran: string[] = [];
  const spoken = spokenActions(menu(ran, { wishlist: false, open: false }));
  assert.deepEqual(
    spoken.accessibilityActions.map((a) => a.name),
    ['share', 'bought_by'],
  );
  for (const name of ['share', 'wishlist', 'open', 'play', 'activate', 'bought_by']) spoken.onAccessibilityAction(act(name));
  assert.deepEqual(ran, ['share', 'bought_by']);
});

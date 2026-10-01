/// <reference types="node" />
/** What the player's play does and says in each state (DESIGN-UI section 10, VIS-5). */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { playerCopy } from './copy';
import { playerNote, playPress, type PlayerStatus } from './transport';

test('play toggles a loaded Release, asks again after an error, and takes no press with no preview', () => {
  const cases: [PlayerStatus, ReturnType<typeof playPress>, string | null][] = [
    ['ready', 'toggle', null],
    ['error', 'retry', playerCopy.error],
    ['unplayable', null, playerCopy.unplayable],
    ['loading', null, null],
    ['idle', null, null],
  ];
  for (const [status, press, note] of cases) {
    assert.equal(playPress(status), press, status);
    assert.equal(playerNote({ status }), note, status);
  }
});

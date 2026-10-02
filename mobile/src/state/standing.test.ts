/// <reference types="node" />
/** A held Fan is signed in only while no pause says otherwise (ADR-0016 amendment 2026-10-02). */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { DEMO_FAN_ID } from '../demo/fan';
import { standingOf } from './standing';

const FAN = { fanId: 2214537 };

test('a Fan signed out from Settings, or paused by Bandcamp, is not connected though the store still holds them', () => {
  assert.equal(standingOf(FAN, null), 'connected');
  assert.equal(standingOf(FAN, 'not_connected'), 'notConnected');
  assert.equal(standingOf(FAN, 'logged_out'), 'signedOut');
  assert.equal(standingOf(null, null), 'notConnected');
  assert.equal(standingOf({ fanId: DEMO_FAN_ID }, null), 'demo');
});

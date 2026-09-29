/// <reference types="node" />
/**
 * The wishlist walk against a Bandcamp standing in for the global `fetch`: the signed-out answer is a login page or an
 * error envelope under an HTTP 200, and a 403, 429 or 5xx is Bandcamp's state, which says nothing about the session
 * (ADR-0017), so it never pauses the store as signed out.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { BandcampAnswer } from './wire';
import { BandcampSession, type ListWalk } from './session';

const HTML = 'text/html; charset=utf-8';

test('only a signed-out answer reads as signed out', async (t) => {
  const cases: readonly [string, number, string, BandcampAnswer<ListWalk>][] = [
    ['the login page', 200, '<!DOCTYPE html><html><title>Log in | Bandcamp</title>', { kind: 'logged_out' }],
    ['a 403 page', 403, '<!DOCTYPE html><html><title>Forbidden</title>', { kind: 'error', status: 403 }],
    ['a 429 page', 429, '<!DOCTYPE html><html><title>Too Many Requests</title>', { kind: 'error', status: 429 }],
    ['a 503 page', 503, '<!DOCTYPE html><html><title>Service Unavailable</title>', { kind: 'error', status: 503 }],
  ];
  for (const [name, status, body, expected] of cases) {
    t.mock.method(globalThis, 'fetch', async () => new Response(body, { status, headers: { 'content-type': HTML } }));
    const answer = await new BandcampSession().fetchWishlistItems(4417093, async () => undefined);
    assert.deepEqual(answer, expected, name);
    t.mock.restoreAll();
  }
});

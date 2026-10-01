/// <reference types="node" />
/**
 * Sign-out against a Bandcamp standing in for the global `fetch` (review REL-3): only an answer below 500 counts as the
 * logout reaching Bandcamp, since Settings keeps the phone signed in on anything else.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { BandcampSession } from './session';

const answers: readonly [string, () => Promise<Response>, 'ok' | 'unreachable'][] = [
  ['the logout page answers', async () => new Response('<html></html>', { status: 200 }), 'ok'],
  ['no network', async () => Promise.reject(new TypeError('Network request failed')), 'unreachable'],
  ['Bandcamp answers 503', async () => new Response('busy', { status: 503 }), 'unreachable'],
];

for (const [name, answer, expected] of answers) {
  test(`sign-out is ${expected} when ${name}`, async (t) => {
    const asked = t.mock.method(globalThis, 'fetch', answer);
    assert.equal(await new BandcampSession().signOut(), expected);
    assert.equal(asked.mock.calls[0]?.arguments[0], 'https://bandcamp.com/logout');
  });
}

/// <reference types="node" />
/**
 * The fetch-target guard (audit S1): a Release URL comes out of a stored document, so the session fetches the page
 * only from its own origin or an https public host name, before the request and again where a redirect landed. The
 * guard has no DNS half on the phone (the `ceiling:` in `wire.ts`).
 */
import assert from 'node:assert/strict';
import { describe, test, type TestContext } from 'node:test';

import { BandcampSession } from './session';
import { isFetchableTarget, onBandcampHost } from './wire';

const BASE = 'https://bandcamp.com';
const KEY = { itemType: 'a', itemId: 1 } as const;

describe('isFetchableTarget', () => {
  test('lets a public https host and the session origin through', () => {
    assert.equal(isFetchableTarget('https://store.sigurros.com/album/atta', BASE), true);
    assert.equal(isFetchableTarget('https://nightgraft.bandcamp.com/album/moth-season', BASE), true);
    assert.equal(isFetchableTarget('https://store.sigurros.com:443/album/atta', BASE), true);
    assert.equal(isFetchableTarget('http://127.0.0.1:8301/album/x', 'http://127.0.0.1:8301'), true);
  });

  test('refuses plain http off its own origin', () => {
    assert.equal(isFetchableTarget('http://malingenie.net/album/x', BASE), false);
  });

  test('refuses IP literals, local names, ports and credentials', () => {
    for (const url of [
      'https://10.0.0.1/',
      'https://[::1]/',
      'https://postgres/',
      'https://localhost/',
      'https://box.local/',
      'https://db.internal/',
      'https://app.localhost/',
      'https://the-box.tail1234.ts.net/',
      'https://0x7f.0x0.0x0.0x1/',
      'https://store.example.com:8443/',
      'https://user:pass@store.example.com/',
    ]) {
      assert.equal(isFetchableTarget(url, BASE), false, url);
    }
  });

  test('refuses what is not a URL', () => {
    for (const url of ['', 'not a url', '/album/x', 'http://[']) assert.equal(isFetchableTarget(url, BASE), false, url);
  });
});

describe('onBandcampHost', () => {
  test('is bandcamp.com and its subdomains over https only', () => {
    assert.equal(onBandcampHost('https://bandcamp.com/feed'), true);
    assert.equal(onBandcampHost('https://nightgraft.bandcamp.com/album/x'), true);
    assert.equal(onBandcampHost('http://nightgraft.bandcamp.com/album/x'), false);
    assert.equal(onBandcampHost('https://store.sigurros.com/album/x'), false);
    assert.equal(onBandcampHost('https://bandcamp.com.evil.example/'), false);
    assert.equal(onBandcampHost('https://evilbandcamp.com/'), false);
  });
});

/** The global `fetch` answering every request with `url` as where it landed. */
function landingAt(t: TestContext, url: string): string[] {
  const calls: string[] = [];
  t.mock.method(globalThis, 'fetch', async (input: string | URL | Request) => {
    calls.push(String(input));
    const response = new Response('<html></html>', { status: 200, headers: { 'content-type': 'text/html' } });
    Object.defineProperty(response, 'url', { value: url });
    return response;
  });
  return calls;
}

describe('fetchReleasePage', () => {
  test('refuses a private target before any request', async (t) => {
    const calls = landingAt(t, '');
    const answer = await new BandcampSession().fetchReleasePage('https://10.0.0.1/album/x', KEY);
    assert.deepEqual(answer, { kind: 'ok', value: { kind: 'refused' } });
    assert.deepEqual(calls, []);
  });

  test('refuses a page whose redirect landed on a private address', async (t) => {
    const calls = landingAt(t, 'http://10.0.0.1:5432/');
    const answer = await new BandcampSession().fetchReleasePage('https://attacker.example/album/x', KEY);
    assert.deepEqual(answer, { kind: 'ok', value: { kind: 'refused' } });
    assert.deepEqual(calls, ['https://attacker.example/album/x']);
  });
});

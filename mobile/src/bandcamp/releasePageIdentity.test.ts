/// <reference types="node" />
/**
 * Which browser the session says it is, against a Bandcamp standing in for the global `fetch`:
 * a release page is asked for as desktop Safari with no cookie, and every other request, the heart's signed-in read of
 * the same page included, goes as the phone the sign-in WebView named.
 */
import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';

import { preorderTralbumBlob, PREORDER_ITEM_ID, PREORDER_URL } from '../../test/fixtures';
import { BandcampSession } from './session';

const DESKTOP_SAFARI =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15';

type Call = { readonly url: string; readonly headers: Readonly<Record<string, string>>; readonly credentials: string | undefined };

const quoted = (value: unknown) => JSON.stringify(value).replace(/"/g, '&quot;');

/** The album page's `<head>` with its `data-tralbum`, and the crumb map a signed-in read finds. */
const RELEASE_PAGE = [
  '<!DOCTYPE html>',
  '<html lang="en"><head>',
  `<meta id="js-crumbs-data" data-crumbs="${quoted({ collect_item_cb: '|collect_item_cb|1727531042|q8Zc+Lm/2vXe0sPd9RkYbQ==' })}">`,
  `<script type="text/javascript" data-tralbum="${quoted(preorderTralbumBlob())}"></script>`,
  '<title>Moth Season | Nightgraft</title>',
  '</head><body class="tralbum-page"></body></html>',
].join('\n');

/** Every request recorded; a page for a GET, `{ ok: true }` for a POST. The clock moves a second a reading. */
function bandcamp(t: TestContext): Call[] {
  const calls: Call[] = [];
  let clock = Date.UTC(2026, 8, 29, 18, 0, 0);
  t.mock.method(Date, 'now', () => (clock += 1000));
  t.mock.method(globalThis, 'fetch', async (input: string | URL | Request, init: RequestInit = {}) => {
    calls.push({ url: String(input), headers: { ...(init.headers as Record<string, string>) }, credentials: init.credentials });
    return init.method === 'POST'
      ? new Response('{"ok":true}', { status: 200, headers: { 'content-type': 'application/json' } })
      : new Response(RELEASE_PAGE, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
  });
  return calls;
}

test('a release page is asked for as desktop Safari, with no cookie', async (t) => {
  const calls = bandcamp(t);
  const answer = await new BandcampSession().fetchReleasePage(PREORDER_URL, { itemType: 'a', itemId: PREORDER_ITEM_ID });

  assert.equal(answer.kind === 'ok' && answer.value.kind, 'page');
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.headers['User-Agent'], DESKTOP_SAFARI);
  assert.equal(calls[0]?.credentials, 'omit');
  assert.equal(calls[0]?.headers.Cookie, undefined);
});

test("the heart's signed-in read of the same page and its write go as the phone", async (t) => {
  const calls = bandcamp(t);
  const session = new BandcampSession();
  const outcome = await session.collectItem({
    fanId: 4417093,
    itemType: 'a',
    itemId: String(PREORDER_ITEM_ID),
    bandId: '3820115',
    releaseUrl: PREORDER_URL,
    standInUrl: null,
  });

  assert.equal(outcome.ok, true);
  assert.deepEqual(
    calls.map((call) => [call.url, call.credentials]),
    [
      [PREORDER_URL, 'include'],
      ['https://bandcamp.com/collect_item_cb', 'include'],
    ],
  );
  for (const call of calls) {
    assert.notEqual(call.headers['User-Agent'], DESKTOP_SAFARI);
    assert.match(call.headers['User-Agent'] ?? '', /Mobile/);
  }
});

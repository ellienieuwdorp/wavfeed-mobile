/// <reference types="node" />
/**
 * The snapshot poke against a Bandcamp standing in for the global `fetch` (ADR-0004 amendment 2026-09-29): the signed-in
 * feed page carries the session's crumbs in `global_head`'s `data-vars` and the `#js-crumbs-data` map, and what lands
 * as the `fan_feed_page` Raw Document is the page's URL, status and byte length, with no crumb value in it (ADR-0003).
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { BandcampSession } from './session';

const FEED_URL = 'https://bandcamp.com/ellie/feed';
const GLOBAL_CRUMB = '|global|1727531042|Jd0v9Yx+Qe3/sKlBn5TzWw==';
const COLLECT_CRUMB = '|collect_item_cb|1727531042|q8Zc+Lm/2vXe0sPd9RkYbQ==';
const FOLLOW_CRUMB = '|follow_band_cb|1727531042|b6Rr0Qh2LfM+NcYs/8dVtA==';

const quoted = (map: Readonly<Record<string, string>>) => JSON.stringify(map).replace(/"/g, '&quot;');

/** The feed page's `<head>` as Bandcamp serves it signed in; the é makes bytes and characters differ. */
const FEED_PAGE = [
  '<!DOCTYPE html>',
  '<html lang="en"><head>',
  `<script type="text/javascript" data-vars="${quoted({ crumb: GLOBAL_CRUMB })}"`,
  ' src="https://s4.bcbits.com/bundle/global_head.js"></script>',
  `<meta id="js-crumbs-data" data-crumbs="${quoted({ collect_item_cb: COLLECT_CRUMB, follow_band_cb: FOLLOW_CRUMB })}">`,
  '<title>Ellie’s feed | Bandcamp</title>',
  '</head><body class="fan-feed">Café</body></html>',
].join('\n');

test('the feed poke stores the page as its url, status and byte length, and no crumb value', async (t) => {
  t.mock.method(globalThis, 'fetch', async () =>
    new Response(FEED_PAGE, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } }),
  );
  const poke = await new BandcampSession().pokeFeedPage('ellie');

  assert.equal(poke.kind, 'ok');
  if (poke.kind !== 'ok') return;
  const stored = JSON.stringify(poke.value);
  for (const crumb of [GLOBAL_CRUMB, COLLECT_CRUMB, FOLLOW_CRUMB]) assert.ok(!stored.includes(crumb), crumb);
  assert.equal(poke.value.endpoint, 'fan_feed_page');
  assert.deepEqual(poke.value.payload, { url: FEED_URL, status: 200, bytes: Buffer.byteLength(FEED_PAGE) });
});

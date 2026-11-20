/// <reference types="node" />
/**
 * The heart's write against a scripted Bandcamp standing in for the global `fetch` (ADR-0016 amendment
 * 2026-09-28): the path's crumb comes off the Release's own page
 * when none is held, rides the write as a form field beside Origin and Referer naming bandcamp.com, stays held until
 * sign-out or a refusal, and a press is at most one page read and three writes. A page with no crumb for the path
 * ends in the identity probe. A Release on a custom domain reads its crumb off a stand-in Release's page on a
 * bandcamp.com host, and a page off bandcamp.com never changes the held crumbs. The page lands as a `crumbs_page` Raw
 * Document of its URL, status and the map's keys, and no outcome carries a crumb value (ADR-0003, ADR-0004). The
 * session's pacing clock is stood in for so a press runs at once.
 */
import assert from 'node:assert/strict';
import { describe, test, type TestContext } from 'node:test';

import { BandcampSession } from './session';
import type { WishlistItem, WishlistWriteOutcome } from './wishlist';

const RELEASE_URL = 'https://lowtidesound.bandcamp.com/album/salt-flats';
const STAND_IN_URL = 'https://quietharbor.bandcamp.com/album/tidewater';
const CUSTOM_URL = 'https://music.lowtidesound.com/album/salt-flats';
const COLLECT = 'https://bandcamp.com/collect_item_cb';
const UNCOLLECT = 'https://bandcamp.com/uncollect_item_cb';
const PROBE = 'https://bandcamp.com/api/fan/2/collection_summary';
const LOGOUT = 'https://bandcamp.com/logout';

const COLLECT_CRUMB = '|collect_item_cb|1727531042|q8Zc+Lm/2vXe0sPd9RkYbQ==';
const UNCOLLECT_CRUMB = '|uncollect_item_cb|1727531042|Wn3T/aKpF+7jHc1uZxEo4g==';
const FOLLOW_CRUMB = '|follow_band_cb|1727531042|b6Rr0Qh2LfM+NcYs/8dVtA==';
const GLOBAL_CRUMB = '|global|1727531042|Jd0v9Yx+Qe3/sKlBn5TzWw==';
const REFRESHED_CRUMB = '|collect_item_cb|1727531377|Tt4Pq/yN1b+cGmXs8LwHeA==';
const FRESH_CRUMB = '|collect_item_cb|1727531090|Hk7Ws2+eVb/QpLx4mRn0cA==';
const CUSTOM_CRUMB = '|uncollect_item_cb|1727531042|Zp2Kd+8sLw/QeYt3Hn0XcB==';

const ITEM: WishlistItem = {
  fanId: 4417093,
  itemType: 'a',
  itemId: '2839471023',
  bandId: '1638201945',
  releaseUrl: RELEASE_URL,
  standInUrl: STAND_IN_URL,
};
const CUSTOM_ITEM: WishlistItem = { ...ITEM, releaseUrl: CUSTOM_URL, standInUrl: null };

type Call = {
  readonly url: string;
  readonly method: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly credentials: string | undefined;
  readonly form: URLSearchParams | null;
};
type Answer = { readonly status?: number; readonly type: string; readonly body: string };
type Responder = (call: Call) => Answer;

const quoted = (map: Readonly<Record<string, string>>) => JSON.stringify(map).replace(/"/g, '&quot;');

/** A Release page's `<head>` as Bandcamp serves it, with `global_head`'s own `data-vars` crumb ahead of the map. */
function releasePage(meta: string): string {
  return [
    '<!DOCTYPE html>',
    '<html lang="en"><head>',
    '<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">',
    `<script type="text/javascript" data-vars="${quoted({ crumb: GLOBAL_CRUMB })}"`,
    ' src="https://s4.bcbits.com/bundle/global_head.js"></script>',
    meta,
    '<title>Salt Flats | Low Tide Sound</title>',
    '</head><body class="tralbum-page"></body></html>',
  ].join('\n');
}

const SIGNED_IN_MAP = {
  follow_band_cb: FOLLOW_CRUMB,
  collect_item_cb: COLLECT_CRUMB,
  uncollect_item_cb: UNCOLLECT_CRUMB,
};

const html = (body: string, status = 200): Answer => ({ status, type: 'text/html; charset=utf-8', body });
const json = (body: unknown, status = 200): Answer => ({
  status,
  type: 'application/json',
  body: JSON.stringify(body),
});
const page = (crumbs: Readonly<Record<string, string>>) =>
  html(releasePage(`<meta id="js-crumbs-data" data-crumbs="${quoted(crumbs)}">`));

const SIGNED_IN_PAGE = page(SIGNED_IN_MAP);
const WRITTEN = json({ ok: true });
const invalidCrumb = (crumb: string, status = 403) => json({ ok: false, error: 'invalid_crumb', crumb }, status);
const BARE_INVALID_CRUMB = json({ ok: false, error: 'invalid_crumb' }, 403);
/** Bandcamp's crash envelope with the words of the refusal seen on the phone 2026-09-28. */
const CRUMB_CRASH = json(
  {
    error: true,
    ok: false,
    exception: 'old or no crumb specified for request to /collect_item',
    host: 'bcweb14.bandcamp.com',
    url: '/collect_item_cb',
    date: '2026-09-28 14:03:11 UTC',
    user: 4417093,
    member_of_current_band: false,
  },
  500,
);
const SIGNED_IN_PROBE = json({ fan_id: 4417093, collection_summary: { fan_id: 4417093, username: 'ellie' } });
const LOGIN_PAGE = html('<!DOCTYPE html><html><head><title>Log in | Bandcamp</title></head><body></body></html>');

/**
 * A Bandcamp that answers each request from the script in order, or from a responder, and records it. The session's
 * clock moves a second per reading, so its 500 to 1000 ms pacing never waits.
 */
function bandcamp(t: TestContext, script: readonly Answer[] | Responder) {
  const calls: Call[] = [];
  const queue = typeof script === 'function' ? [] : [...script];
  let clock = Date.UTC(2026, 8, 28, 14, 0, 0);
  t.mock.method(Date, 'now', () => (clock += 1000));
  t.mock.method(globalThis, 'fetch', async (input: string | URL, init: RequestInit = {}) => {
    const body = typeof init.body === 'string' ? init.body : null;
    const call: Call = {
      url: String(input),
      method: init.method ?? 'GET',
      headers: { ...(init.headers as Record<string, string>) },
      credentials: init.credentials,
      form: body === null ? null : new URLSearchParams(body),
    };
    calls.push(call);
    const answer = typeof script === 'function' ? script(call) : queue.shift();
    if (answer === undefined) throw new Error(`the script ran out at ${call.method} ${call.url}`);
    return new Response(answer.body, { status: answer.status ?? 200, headers: { 'content-type': answer.type } });
  });
  return {
    calls,
    /** Each call as `METHOD url`, a write followed by the crumb it carried. */
    trace: () =>
      calls.map((call) => `${call.method} ${call.url}${call.form === null ? '' : ` ${call.form.get('crumb')}`}`),
  };
}

function failureOf(outcome: WishlistWriteOutcome): string | null {
  return outcome.ok ? null : outcome.failure;
}

describe('the crumb', () => {
  test("a first press reads the Release's page signed in, then writes its crumb with Origin and Referer", async (t) => {
    const wire = bandcamp(t, [SIGNED_IN_PAGE, WRITTEN]);
    const outcome = await new BandcampSession().collectItem(ITEM);

    assert.equal(failureOf(outcome), null);
    assert.deepEqual(wire.trace(), [`GET ${RELEASE_URL}`, `POST ${COLLECT} ${COLLECT_CRUMB}`]);
    const [read, write] = wire.calls;
    assert.equal(read?.credentials, 'include');
    assert.equal(write?.credentials, 'include');
    assert.equal(write.headers.Origin, 'https://bandcamp.com');
    assert.equal(write.headers.Referer, 'https://bandcamp.com/');
    assert.deepEqual(Object.fromEntries(write.form ?? []), {
      fan_id: '4417093',
      item_id: '2839471023',
      item_type: 'a',
      band_id: '1638201945',
      crumb: COLLECT_CRUMB,
    });
  });

  describe('the page map is read in any markup the site could serve it in', () => {
    const map = `{"collect_item_cb":"${COLLECT_CRUMB}"}`;
    const cases: readonly (readonly [string, string])[] = [
      ['single quotes around raw JSON, the map first', `<meta data-crumbs='${map}' id='js-crumbs-data'>`],
      [
        'numeric entities, an unquoted id, self-closed',
        `<meta id=js-crumbs-data data-crumbs="${map.replace(/"/g, '&#34;')}" />`,
      ],
      ['hex entities and upper-case names', `<META DATA-CRUMBS="${map.replace(/"/g, '&#X22;')}" ID="js-crumbs-data">`],
    ];
    for (const [name, meta] of cases) {
      test(name, async (t) => {
        const wire = bandcamp(t, [html(releasePage(meta)), WRITTEN]);
        assert.equal(failureOf(await new BandcampSession().collectItem(ITEM)), null);
        assert.equal(wire.calls[1]?.form?.get('crumb'), COLLECT_CRUMB);
      });
    }
  });

  test("later presses reuse each path's held crumb without reading the page again", async (t) => {
    const wire = bandcamp(t, [SIGNED_IN_PAGE, WRITTEN, WRITTEN, WRITTEN]);
    const session = new BandcampSession();
    const outcomes = [];
    for (const press of ['add', 'remove', 'add']) {
      outcomes.push(await (press === 'add' ? session.collectItem(ITEM) : session.uncollectItem(ITEM)));
    }

    assert.deepEqual(outcomes.map(failureOf), [null, null, null]);
    assert.deepEqual(wire.trace(), [
      `GET ${RELEASE_URL}`,
      `POST ${COLLECT} ${COLLECT_CRUMB}`,
      `POST ${UNCOLLECT} ${UNCOLLECT_CRUMB}`,
      `POST ${COLLECT} ${COLLECT_CRUMB}`,
    ]);
  });

  test('sign-out forgets the held crumbs, so a signed-out page then reads as signed out', async (t) => {
    const wire = bandcamp(t, [SIGNED_IN_PAGE, WRITTEN, LOGIN_PAGE, page({}), LOGIN_PAGE]);
    const session = new BandcampSession();
    assert.equal(failureOf(await session.collectItem(ITEM)), null);
    assert.equal(await session.signOut(), 'ok');
    const outcome = await session.uncollectItem(ITEM);

    assert.equal(failureOf(outcome), 'logged_out');
    assert.deepEqual(wire.trace(), [
      `GET ${RELEASE_URL}`,
      `POST ${COLLECT} ${COLLECT_CRUMB}`,
      `GET ${LOGOUT}`,
      `GET ${RELEASE_URL}`,
      `GET ${PROBE}`,
    ]);
  });

  describe('a signed-in page with no crumb for the path is refused without a write', () => {
    const cases: readonly (readonly [string, Answer])[] = [
      ['a map without the path', page({ follow_band_cb: FOLLOW_CRUMB })],
      ['no map at all', html(releasePage('<meta name="description" content="Salt Flats by Low Tide Sound">'))],
    ];
    for (const [name, answer] of cases) {
      test(name, async (t) => {
        const wire = bandcamp(t, [answer, SIGNED_IN_PROBE]);
        const outcome = await new BandcampSession().collectItem(ITEM);
        assert.equal(failureOf(outcome), 'bandcamp_rejected');
        assert.deepEqual(wire.trace(), [`GET ${RELEASE_URL}`, `GET ${PROBE}`]);
      });
    }
  });

  test('a page with no crumb and a probe Bandcamp turns away with a 429 is unreachable, not signed out', async (t) => {
    const wire = bandcamp(t, [page({}), html('<!DOCTYPE html><html><title>Too Many Requests</title>', 429)]);
    const outcome = await new BandcampSession().collectItem(ITEM);
    assert.equal(failureOf(outcome), 'bandcamp_unreachable');
    assert.deepEqual(wire.trace(), [`GET ${RELEASE_URL}`, `GET ${PROBE}`]);
  });
});

describe('a refused crumb', () => {
  test('invalid_crumb carrying a fresh crumb is replayed with it, and that one held for the next press', async (t) => {
    const wire = bandcamp(t, [SIGNED_IN_PAGE, invalidCrumb(FRESH_CRUMB), WRITTEN, WRITTEN]);
    const session = new BandcampSession();
    const outcomes = [await session.collectItem(ITEM), await session.collectItem(ITEM)];

    assert.deepEqual(outcomes.map(failureOf), [null, null]);
    assert.deepEqual(wire.trace(), [
      `GET ${RELEASE_URL}`,
      `POST ${COLLECT} ${COLLECT_CRUMB}`,
      `POST ${COLLECT} ${FRESH_CRUMB}`,
      `POST ${COLLECT} ${FRESH_CRUMB}`,
    ]);
  });

  describe('without a fresh crumb, the held one is dropped and the page read once more', () => {
    const cases: readonly (readonly [string, Answer])[] = [
      ['the crash envelope naming the crumb, under an HTTP 500', CRUMB_CRASH],
      ['a bare invalid_crumb', BARE_INVALID_CRUMB],
    ];
    for (const [name, refusal] of cases) {
      test(name, async (t) => {
        const refreshed = page({ ...SIGNED_IN_MAP, collect_item_cb: REFRESHED_CRUMB });
        const wire = bandcamp(t, [SIGNED_IN_PAGE, WRITTEN, refusal, refreshed, WRITTEN]);
        const session = new BandcampSession();
        await session.collectItem(ITEM);
        const outcome = await session.collectItem(ITEM);

        assert.equal(failureOf(outcome), null);
        assert.deepEqual(wire.trace().slice(2), [
          `POST ${COLLECT} ${COLLECT_CRUMB}`,
          `GET ${RELEASE_URL}`,
          `POST ${COLLECT} ${REFRESHED_CRUMB}`,
        ]);
      });
    }
  });

  test('a press stops at one page read and three writes, and a crumb it gave up on is not sent again', async (t) => {
    let writes = 0;
    const wire = bandcamp(t, (call) => {
      if (call.method === 'GET') return SIGNED_IN_PAGE;
      writes += 1;
      return writes === 1 ? WRITTEN : writes === 2 ? invalidCrumb(FRESH_CRUMB, 200) : CRUMB_CRASH;
    });
    const session = new BandcampSession();
    const outcomes = [];
    for (let press = 0; press < 3; press += 1) outcomes.push(await session.collectItem(ITEM));

    assert.deepEqual(outcomes.map(failureOf), [null, 'bandcamp_rejected', 'bandcamp_rejected']);
    assert.deepEqual(wire.trace(), [
      `GET ${RELEASE_URL}`,
      `POST ${COLLECT} ${COLLECT_CRUMB}`,
      `POST ${COLLECT} ${COLLECT_CRUMB}`,
      `POST ${COLLECT} ${FRESH_CRUMB}`,
      `GET ${RELEASE_URL}`,
      `POST ${COLLECT} ${COLLECT_CRUMB}`,
      `GET ${RELEASE_URL}`,
      `POST ${COLLECT} ${COLLECT_CRUMB}`,
    ]);
  });

  test('invalid_crumb with a fresh crumb every time stops at the third write', async (t) => {
    let turn = 0;
    const wire = bandcamp(t, (call) =>
      call.method === 'GET' ? SIGNED_IN_PAGE : invalidCrumb(`|collect_item_cb|172753110${(turn += 1)}|Qm9v==`),
    );
    const outcome = await new BandcampSession().collectItem(ITEM);

    assert.equal(failureOf(outcome), 'bandcamp_rejected');
    assert.deepEqual(
      wire.calls.map((call) => call.method),
      ['GET', 'POST', 'POST', 'POST'],
    );
  });
});

describe('a Release on a custom domain', () => {
  /** The jar sends the session to bandcamp.com hosts only, so a custom domain's page reads signed out. */
  const byHost = (call: Call): Answer =>
    call.url === PROBE
      ? SIGNED_IN_PROBE
      : call.method === 'POST'
        ? WRITTEN
        : call.url.startsWith('https://music.')
          ? page({})
          : SIGNED_IN_PAGE;

  test("reads the crumb off the stand-in Release's page on a bandcamp.com host", async (t) => {
    const wire = bandcamp(t, byHost);
    const outcome = await new BandcampSession().collectItem({ ...CUSTOM_ITEM, standInUrl: STAND_IN_URL });

    assert.equal(failureOf(outcome), null);
    assert.deepEqual(wire.trace(), [`GET ${STAND_IN_URL}`, `POST ${COLLECT} ${COLLECT_CRUMB}`]);
  });

  test('with no stand-in held, reads its own page, which carries no crumb, and is refused without a write', async (t) => {
    const wire = bandcamp(t, byHost);
    const outcome = await new BandcampSession().collectItem(CUSTOM_ITEM);

    assert.equal(failureOf(outcome), 'bandcamp_rejected');
    assert.deepEqual(wire.trace(), [`GET ${CUSTOM_URL}`, `GET ${PROBE}`]);
  });

  describe("its page's map neither drops nor replaces a held crumb", () => {
    const cases: readonly (readonly [string, Answer])[] = [
      ['an empty map', page({})],
      ['a map with a crumb of its own', page({ uncollect_item_cb: CUSTOM_CRUMB })],
    ];
    for (const [name, custom] of cases) {
      test(name, async (t) => {
        const wire = bandcamp(t, [SIGNED_IN_PAGE, WRITTEN, CRUMB_CRASH, custom, SIGNED_IN_PROBE, WRITTEN]);
        const session = new BandcampSession();
        await session.collectItem(ITEM);
        await session.collectItem(CUSTOM_ITEM);
        const outcome = await session.uncollectItem(CUSTOM_ITEM);

        assert.equal(failureOf(outcome), null);
        assert.deepEqual(wire.trace().slice(2), [
          `POST ${COLLECT} ${COLLECT_CRUMB}`,
          `GET ${CUSTOM_URL}`,
          `GET ${PROBE}`,
          `POST ${UNCOLLECT} ${UNCOLLECT_CRUMB}`,
        ]);
      });
    }
  });
});

describe('what a press returns', () => {
  test('the crumbs_page document holds the url, status and map keys', async (t) => {
    bandcamp(t, [page({ follow_band_cb: FOLLOW_CRUMB, uncollect_item_cb: UNCOLLECT_CRUMB }), SIGNED_IN_PROBE]);
    const [stored] = (await new BandcampSession().collectItem(ITEM)).documents;

    assert.equal(stored?.endpoint, 'crumbs_page');
    assert.deepEqual(stored.payload, { url: RELEASE_URL, status: 200, paths: ['follow_band_cb', 'uncollect_item_cb'] });
  });

  test('an invalid_crumb answer is stored naming its crumb field, without the value', async (t) => {
    bandcamp(t, [SIGNED_IN_PAGE, invalidCrumb(FRESH_CRUMB), WRITTEN]);
    const outcome = await new BandcampSession().collectItem(ITEM);

    assert.deepEqual(
      outcome.documents.slice(1).map((document) => document.payload),
      [{ ok: false, error: 'invalid_crumb', crumb: '[redacted]' }, { ok: true }],
    );
  });

  describe('no crumb value, off the page or out of an answer', () => {
    const crumbs = [COLLECT_CRUMB, UNCOLLECT_CRUMB, FOLLOW_CRUMB, GLOBAL_CRUMB, FRESH_CRUMB];
    const cases: readonly (readonly [string, readonly Answer[]])[] = [
      ['a written press', [SIGNED_IN_PAGE, WRITTEN]],
      ['a press refused for want of its crumb', [page({ follow_band_cb: FOLLOW_CRUMB }), SIGNED_IN_PROBE]],
      ['a replay with the crumb invalid_crumb handed back', [SIGNED_IN_PAGE, invalidCrumb(FRESH_CRUMB), WRITTEN]],
      [
        'replays spent on handed-back crumbs',
        [SIGNED_IN_PAGE, invalidCrumb(FRESH_CRUMB), invalidCrumb(FRESH_CRUMB), invalidCrumb(FRESH_CRUMB)],
      ],
      ['a write answered with a signed-in page', [SIGNED_IN_PAGE, SIGNED_IN_PAGE, SIGNED_IN_PROBE]],
      [
        'a crash envelope quoting the crumb it refused',
        [SIGNED_IN_PAGE, json({ error: true, ok: false, exception: `old crumb ${COLLECT_CRUMB} for /collect_item` }, 500)],
      ],
    ];
    for (const [name, script] of cases) {
      test(name, async (t) => {
        bandcamp(t, script);
        const kept = JSON.stringify(await new BandcampSession().collectItem(ITEM));
        for (const crumb of crumbs) {
          assert.equal(kept.includes(crumb), false, `the outcome carries ${crumb.split('|')[1]}'s crumb`);
        }
      });
    }
  });
});

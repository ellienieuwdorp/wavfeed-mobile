/// <reference types="node" />
/**
 * Where a Release's date comes from (task 0041, decision 1; ADR-0011 amended): a release page or the Sweep outranks the
 * feed, the newer of a page and a Sweep wins, a Release the feed once named a pre-order takes no date from the feed, and
 * the Raw Documents' fold order never changes which date is held.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  bandDetailsPayload,
  discographyItem,
  feedPayload,
  ITEM_ID,
  nrEntry,
  PREORDER_ITEM_ID,
  PREORDER_URL,
  preorderNrEntry,
  preorderTralbumBlob,
  releasePagePayload,
} from '../../test/fixtures';
import { openTestStore } from '../../test/nodeDb';
import { BandcampSession } from '../bandcamp/session';
import { BAND_DETAILS_ENDPOINT, FEED_UPDATES_ENDPOINT, FOLLOWING_BANDS_ENDPOINT, RELEASE_PAGE_ENDPOINT, WISHLIST_ITEMS_ENDPOINT } from '../domain/endpoints';
import { readUndatedReleases } from './enrichment';
import { fold, rebuild } from './projection';
import { listStoryRows } from './queries';
import { insertRawDocument, type RawDocumentInput } from './rawDocuments';

/** The feed says 14 August, the page 5 August, the Sweep 20 August. */
const FEED_DAY = '2026-08-14T00:00:00.000Z';
const PAGE_DAY = '2026-08-05T00:00:00.000Z';
const SWEEP_DAY = '2026-08-20T00:00:00.000Z';

function feedRead(fetchedAt: string, collected: number): RawDocumentInput {
  return { endpoint: FEED_UPDATES_ENDPOINT, payload: feedPayload({ entries: [nrEntry({ also_collected_count: collected })] }), fetchedAt };
}

function pageRead(fetchedAt: string): RawDocumentInput {
  return { endpoint: RELEASE_PAGE_ENDPOINT, payload: releasePagePayload(), fetchedAt };
}

function sweepRead(fetchedAt: string): RawDocumentInput {
  const item = discographyItem({
    item_id: ITEM_ID,
    title: 'Slow Harbour',
    item_url: 'https://nightgraft.bandcamp.com/album/slow-harbour',
    release_date: '20 Aug 2026 00:00:00 GMT',
    is_preorder: false,
  });
  return { endpoint: BAND_DETAILS_ENDPOINT, payload: bandDetailsPayload({ items: [item] }), fetchedAt };
}

function preorderFeedRead(fetchedAt: string, isPreorder: boolean, playing: number): RawDocumentInput {
  const entry = preorderNrEntry({ is_preorder: isPreorder, num_streamable_tracks: playing });
  return { endpoint: FEED_UPDATES_ENDPOINT, payload: feedPayload({ entries: [entry] }), fetchedAt };
}

function preorderPageRead(fetchedAt: string): RawDocumentInput {
  const payload = releasePagePayload({ itemId: PREORDER_ITEM_ID, itemUrl: PREORDER_URL, tralbum: preorderTralbumBlob() });
  return { endpoint: RELEASE_PAGE_ENDPOINT, payload, fetchedAt };
}

/**
 * Folds the reads in the order given, one fold each, and answers the date the Release's Story row carries and the
 * Releases due a release page read at `now`.
 */
async function held(reads: readonly RawDocumentInput[], now = new Date(Date.UTC(2026, 9, 14, 12))) {
  const { db, close } = await openTestStore();
  for (const read of reads) {
    await insertRawDocument(db, read);
    await fold(db);
  }
  const [row] = await listStoryRows(db);
  const due = (await readUndatedReleases(db, 10, now)).map((release) => release.itemId);
  close();
  return { date: row?.releaseDate?.toISOString() ?? null, due };
}

async function heldDate(reads: readonly RawDocumentInput[]): Promise<string | null> {
  return (await held(reads)).date;
}

test('a release page date outlasts the feed, whichever of them folds last', async () => {
  const first = feedRead('2026-09-01T00:00:00.000Z', 12);
  const page = pageRead('2026-09-02T00:00:00.000Z');
  const later = feedRead('2026-09-04T00:00:00.000Z', 13);

  assert.equal(await heldDate([first]), FEED_DAY);
  assert.equal(await heldDate([first, page, later]), PAGE_DAY);
  assert.equal(await heldDate([later, page, first]), PAGE_DAY);
});

test('between a release page and the Sweep the newer read wins, in either fold order, and the feed moves neither', async () => {
  const first = feedRead('2026-09-01T00:00:00.000Z', 12);
  const page = pageRead('2026-09-02T00:00:00.000Z');
  const sweep = sweepRead('2026-09-03T00:00:00.000Z');
  const later = feedRead('2026-09-04T00:00:00.000Z', 13);
  const newerPage = pageRead('2026-09-05T00:00:00.000Z');

  assert.equal(await heldDate([first, page, sweep, later]), SWEEP_DAY);
  assert.equal(await heldDate([sweep, later, page, first]), SWEEP_DAY);
  assert.equal(await heldDate([first, sweep, newerPage, later]), PAGE_DAY);
  assert.equal(await heldDate([later, newerPage, sweep]), PAGE_DAY);
});

test('a page read and a Sweep read fetched in the same moment hold one date, in either fold order', async () => {
  const first = feedRead('2026-09-01T00:00:00.000Z', 12);
  const page = pageRead('2026-09-02T00:00:00.000Z');
  const sweep = sweepRead('2026-09-02T00:00:00.000Z');

  assert.equal(await heldDate([first, page, sweep]), await heldDate([first, sweep, page]));
  assert.equal(await heldDate([sweep, first, page]), await heldDate([page, first, sweep]));
});

test('a pre-order whose feed entry is rewritten as out waits undated for its release page, in either fold order', async () => {
  const announced = preorderFeedRead('2026-09-29T10:00:00.000Z', true, 1);
  const rewritten = preorderFeedRead('2026-10-14T10:00:00.000Z', false, 4);
  const page = preorderPageRead('2026-10-14T11:00:00.000Z');

  assert.deepEqual(await held([announced, rewritten]), { date: null, due: [PREORDER_ITEM_ID] });
  assert.deepEqual(await held([rewritten, announced]), { date: null, due: [PREORDER_ITEM_ID] });
  assert.deepEqual(await held([announced, rewritten, page]), { date: '2026-10-13T00:00:00.000Z', due: [] });
  assert.deepEqual(await held([rewritten, page, announced]), { date: '2026-10-13T00:00:00.000Z', due: [] });
});

const OLD_SNAPSHOT = '2026-10-01T12:00:00.000Z';
const NEW_SNAPSHOT = '2026-10-02T12:00:00.000Z';
type SnapshotEndpoint = typeof FOLLOWING_BANDS_ENDPOINT | typeof WISHLIST_ITEMS_ENDPOINT;

/** Pages as the session records them, including the cursor it asked and the one Bandcamp handed back (task 0068). */
function snapshotPage(endpoint: SnapshotEndpoint, startedAt: string, ids: readonly unknown[], page = 1, more = false, inputToken?: string | null, nextToken: string | null = null): RawDocumentInput {
  const firstToken = endpoint === WISHLIST_ITEMS_ENDPOINT ? `${Date.parse(startedAt) / 1000}::a::` : null;
  const snapshotPage = { number: page, inputToken: inputToken === undefined ? firstToken : inputToken, nextToken };
  const items = ids.map((id) => endpoint === WISHLIST_ITEMS_ENDPOINT ? { tralbum_type: 'a', tralbum_id: id } : { band_id: id });
  const payload = endpoint === WISHLIST_ITEMS_ENDPOINT
    ? { snapshot_started_at: startedAt, snapshotPage, request: { fan_id: 2214537, older_than_token: snapshotPage.inputToken }, response: { items, more_available: more, last_token: nextToken } }
    : { fanId: 2214537, page, snapshotStartedAt: startedAt, snapshotPage, followingBands: { items, more_available: more, last_token: nextToken } };
  return { endpoint, payload, fetchedAt: startedAt };
}

function legacyPage(page: RawDocumentInput): RawDocumentInput {
  const payload = { ...(page.payload as Record<string, unknown>) };
  delete payload.snapshotPage;
  return { ...page, payload };
}

function unreadablePage(page: RawDocumentInput): RawDocumentInput {
  const payload = { ...(page.payload as Record<string, unknown>) };
  const key = page.endpoint === WISHLIST_ITEMS_ENDPOINT ? 'response' : 'followingBands';
  payload[key] = { ...(payload[key] as Record<string, unknown>), items: 'unreadable' };
  return { ...page, payload };
}

function firstFollowingPage(count: unknown): RawDocumentInput {
  const page = snapshotPage(FOLLOWING_BANDS_ENDPOINT, NEW_SNAPSHOT, []);
  return { ...page, payload: {
    ...(page.payload as Record<string, unknown>),
    followingBands: { item_cache: { following_bands: { '8002': { band_id: 8002 } } }, following_bands: { item_count: count, last_token: 'one' } },
  } };
}

for (const endpoint of [WISHLIST_ITEMS_ENDPOINT, FOLLOWING_BANDS_ENDPOINT] as const) {
  test(`${endpoint}: only a complete readable contiguous snapshot removes old membership, including on replay`, async () => {
    const cases: { name: string; pages: RawDocumentInput[]; held: number[] }[] = [
      { name: 'malformed terminal entry', pages: [snapshotPage(endpoint, NEW_SNAPSHOT, [8002, 'unreadable'])], held: [8001, 8002] },
      { name: 'malformed preceding page', pages: [snapshotPage(endpoint, NEW_SNAPSHOT, ['unreadable'], 1, true, undefined, 'one'), snapshotPage(endpoint, NEW_SNAPSHOT, [8002], 2, false, 'one')], held: [8001, 8002] },
      { name: 'unparsable preceding payload', pages: [unreadablePage(snapshotPage(endpoint, NEW_SNAPSHOT, [8001], 1, true, undefined, 'one')), snapshotPage(endpoint, NEW_SNAPSHOT, [8002], 2, false, 'one')], held: [8001, 8002] },
      { name: 'corrupt preceding page receipt', pages: [{ ...snapshotPage(endpoint, NEW_SNAPSHOT, [8001], 1, true, undefined, 'one'), payload: { ...(snapshotPage(endpoint, NEW_SNAPSHOT, [8001], 1, true, undefined, 'one').payload as Record<string, unknown>), snapshotPage: { number: 'unreadable', inputToken: null, nextToken: 'one' } } }, snapshotPage(endpoint, NEW_SNAPSHOT, [8002], 2, false, 'one')], held: [8001, 8002] },
      { name: 'missing first page', pages: [snapshotPage(endpoint, NEW_SNAPSHOT, [8002], 2, false, 'one')], held: [8001, 8002] },
      { name: 'missing middle page', pages: [snapshotPage(endpoint, NEW_SNAPSHOT, [8002], 1, true, undefined, 'one'), snapshotPage(endpoint, NEW_SNAPSHOT, [], 3, false, 'two')], held: [8001, 8002] },
      { name: 'wrong continuation cursor', pages: [snapshotPage(endpoint, NEW_SNAPSHOT, [8002], 1, true, undefined, 'one'), snapshotPage(endpoint, NEW_SNAPSHOT, [], 2, false, 'wrong')], held: [8001, 8002] },
      { name: 'out of order pages', pages: [snapshotPage(endpoint, NEW_SNAPSHOT, [], 2, false, 'one'), snapshotPage(endpoint, NEW_SNAPSHOT, [8002], 1, true, undefined, 'one')], held: [8001, 8002] },
      { name: 'partial snapshot', pages: [snapshotPage(endpoint, NEW_SNAPSHOT, [8002], 1, true, undefined, 'one')], held: [8001, 8002] },
      { name: 'complete snapshot', pages: [snapshotPage(endpoint, NEW_SNAPSHOT, [8002], 1, true, undefined, 'one'), snapshotPage(endpoint, NEW_SNAPSHOT, [], 2, false, 'one')], held: [8002] },
      { name: 'legacy complete snapshot', pages: [legacyPage(snapshotPage(endpoint, NEW_SNAPSHOT, [8002], 1, true, undefined, 'one')), legacyPage(snapshotPage(endpoint, NEW_SNAPSHOT, [], 2, false, 'one'))], held: [8002] },
      { name: 'legacy missing first page', pages: [legacyPage(snapshotPage(endpoint, NEW_SNAPSHOT, [8002], 2, false, 'one'))], held: [8001, 8002] },
    ];
    const cycling = [
      snapshotPage(endpoint, NEW_SNAPSHOT, [8002], 1, true, undefined, 'one'),
      snapshotPage(endpoint, NEW_SNAPSHOT, [], 2, true, 'one', 'two'),
      snapshotPage(endpoint, NEW_SNAPSHOT, [], 3, true, 'two', 'one'),
      snapshotPage(endpoint, NEW_SNAPSHOT, [], 4, false, 'one'),
    ];
    cases.push({ name: 'pagination cursor cycle', pages: cycling, held: [8001, 8002] });
    cases.push({ name: 'legacy pagination cursor cycle', pages: cycling.map(legacyPage), held: [8001, 8002] });
    if (endpoint === FOLLOWING_BANDS_ENDPOINT) {
      for (const count of [-1, 0.5]) {
        cases.push({ name: `invalid first-page count ${count}`, pages: [firstFollowingPage(count)], held: [8001, 8002] });
        cases.push({ name: `legacy invalid first-page count ${count}`, pages: [legacyPage(firstFollowingPage(count))], held: [8001, 8002] });
      }
    }
    for (const scenario of cases) {
      const { db, close } = await openTestStore();
      try {
        await insertRawDocument(db, snapshotPage(endpoint, OLD_SNAPSHOT, [8001, 8002]));
        await fold(db);
        for (const page of scenario.pages) {
          await insertRawDocument(db, page);
          await fold(db);
        }
        const table = endpoint === WISHLIST_ITEMS_ENDPOINT ? 'wishlist_items' : 'follows';
        const column = endpoint === WISHLIST_ITEMS_ENDPOINT ? 'item_id' : 'band_id';
        const membership = async () => (await db.getAllAsync<{ id: number }>(`select ${column} as id from ${table} order by ${column}`)).map((row) => row.id);
        assert.deepEqual(await membership(), scenario.held, scenario.name);
        await rebuild(db);
        assert.deepEqual(await membership(), scenario.held, `${scenario.name} after replay`);
      } finally {
        close();
      }
    }
  });
}

test('a snapshot whose earlier page was quarantined remains additive, and a rebuild retries the proof after repair', async () => {
  const { db, close } = await openTestStore();
  try {
    await insertRawDocument(db, snapshotPage(WISHLIST_ITEMS_ENDPOINT, OLD_SNAPSHOT, [8001, 8002, 8003]));
    await fold(db);
    await db.execAsync("create trigger poison_snapshot before insert on wishlist_items when new.item_id = 8001 begin select raise(abort, 'poison snapshot'); end");
    await insertRawDocument(db, snapshotPage(WISHLIST_ITEMS_ENDPOINT, NEW_SNAPSHOT, [8001], 1, true, undefined, 'one'));
    assert.equal((await fold(db)).documentsFailed, 1);
    await insertRawDocument(db, snapshotPage(WISHLIST_ITEMS_ENDPOINT, NEW_SNAPSHOT, [8002], 2, false, 'one'));
    await fold(db);
    const membership = async () => (await db.getAllAsync<{ item_id: number }>('select item_id from wishlist_items order by item_id')).map((row) => row.item_id);
    assert.deepEqual(await membership(), [8001, 8002, 8003]);
    await db.execAsync('drop trigger poison_snapshot');
    await rebuild(db);
    assert.deepEqual(await membership(), [8001, 8002]);
  } finally {
    close();
  }
});

test('the session produces the receipt chain that admits a complete wishlist or follows snapshot', async (t) => {
  let clock = Date.now();
  t.mock.method(Date, 'now', () => (clock += 1000));
  for (const endpoint of [WISHLIST_ITEMS_ENDPOINT, FOLLOWING_BANDS_ENDPOINT] as const) {
    const { db, close } = await openTestStore();
    try {
      await insertRawDocument(db, snapshotPage(endpoint, OLD_SNAPSHOT, [8001, 8002]));
      await fold(db);
      const wishlist = endpoint === WISHLIST_ITEMS_ENDPOINT;
      let asked = 0;
      t.mock.method(globalThis, 'fetch', async (_input: unknown, init: RequestInit = {}) => {
        asked += 1;
        if (asked === 2) assert.equal((JSON.parse(init.body as string) as { older_than_token: string }).older_than_token, 'one');
        const body = asked === 1
          ? wishlist ? { items: [{ tralbum_type: 'a', tralbum_id: 8002 }], more_available: true, last_token: 'one' }
            : { item_cache: { following_bands: { '8002': { band_id: 8002 } } }, following_bands: { item_count: 2, last_token: 'one' } }
          : { items: [wishlist ? { tralbum_type: 'a', tralbum_id: 8003 } : { band_id: 8003 }], more_available: false };
        const text = !wishlist && asked === 1 ? `<script id="pagedata" data-blob="${JSON.stringify(body).replaceAll('"', '&quot;')}"></script>` : JSON.stringify(body);
        return new Response(text, { headers: { 'content-type': !wishlist && asked === 1 ? 'text/html' : 'application/json' } });
      });
      const session = new BandcampSession();
      const onDocument = async (doc: RawDocumentInput) => { await insertRawDocument(db, doc); await fold(db); };
      const answer = wishlist ? await session.fetchWishlistItems(2214537, onDocument) : await session.fetchFollowingBands(2214537, 'synthetic', onDocument);
      assert.deepEqual(answer, { kind: 'ok', value: { pages: 2, seen: 2, complete: true } });
      const table = wishlist ? 'wishlist_items' : 'follows';
      const column = wishlist ? 'item_id' : 'band_id';
      assert.deepEqual((await db.getAllAsync<{ id: number }>(`select ${column} as id from ${table} order by ${column}`)).map((row) => row.id), [8002, 8003]);
    } finally {
      close();
    }
  }
});

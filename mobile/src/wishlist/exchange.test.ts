/// <reference types="node" />
/** The production wishlist exchange on real SQLite: confirmation lands while active and stops after retirement (task 0068). */
import assert from 'node:assert/strict';
import { mock, test, type TestContext } from 'node:test';

import type { BandcampDocument } from '../bandcamp/wire';
import { COLLECT_ITEM_ENDPOINT } from '../bandcamp/wire';
import type { WishlistWriteOutcome } from '../bandcamp/wishlist';
import { emptyStore } from '../store/schema';
import { IDENTITY_KEY, writeKv } from '../store/kv';
import { insertRawDocument } from '../store/rawDocuments';
import { fold } from '../store/projection';
import { openTestStore } from '../../test/nodeDb';
import { exchange, type WishlistTarget } from './exchange';
import { beginWishlist, retireWishlist, wishlistLifetime } from './membership';

const TARGET: WishlistTarget = { itemType: 'a', itemId: '1001', release: { itemType: 'a', itemId: '1001' } };
const DOCUMENT: BandcampDocument = { endpoint: COLLECT_ITEM_ENDPOINT, payload: { ok: true }, fetchedAt: '2026-10-12T12:00:00Z' };
const WIRE = { status: 200, requests: 1, answer: 'json', end: 'ok', said: null, redirected: false, crumb: 'cached', pages: 0, pageStatus: null } as const;

function outcome(ok: boolean): WishlistWriteOutcome {
  return ok
    ? { ok: true, alreadyThere: false, wire: WIRE, documents: [DOCUMENT] }
    : { ok: false, failure: 'bandcamp_rejected', detail: 'Bandcamp refused the wishlist write', reason: null, wire: WIRE, documents: [DOCUMENT] };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((answer) => { resolve = answer; });
  return { promise, resolve };
}

async function fixture(t: TestContext) {
  const { db, close } = await openTestStore();
  t.after(close);
  await writeKv(db, IDENTITY_KEY, { fanId: 23, username: 'fan', name: null, avatarUrl: null });
  await db.runAsync(
    `insert into releases (item_type, item_id, band_id, title, url, first_seen_at, last_seen_at)
     values ('a', 1001, 7, 'Release', 'https://page.bandcamp.com/album/release', '2026-10-01', '2026-10-01')`,
  );
  const app: Parameters<typeof exchange>[0] = {
    db,
    session: {
      fetchReleasePage: async () => ({ kind: 'unreachable' }),
      collectItem: async () => outcome(true),
      uncollectItem: async () => outcome(true),
    },
    putRaw: async (document) => {
      const stored = await insertRawDocument(db, document);
      await fold(db);
      return stored;
    },
  };
  const counts = async () => ({
    raw: (await db.getFirstAsync<{ n: number }>('select count(*) as n from raw_documents'))?.n,
    wishlist: (await db.getFirstAsync<{ n: number }>('select count(*) as n from wishlist_items'))?.n,
  });
  return { db, app, counts };
}

test('an active confirmed add persists its response and membership', async (t) => {
  const { db, app, counts } = await fixture(t);
  const sent = await exchange(app, TARGET, 'add', wishlistLifetime(db));
  assert.equal(sent?.failure, null);
  assert.deepEqual(await counts(), { raw: 1, wishlist: 1 });
});

for (const ok of [true, false]) {
  test(`an old ${ok ? 'confirmed' : 'refused'} write does not persist after retirement and same-database reuse`, async (t) => {
    const { db, app, counts } = await fixture(t);
    const entered = deferred<void>();
    const answer = deferred<WishlistWriteOutcome>();
    app.session.collectItem = () => { entered.resolve(); return answer.promise; };
    const sent = exchange(app, TARGET, 'add', wishlistLifetime(db));
    await entered.promise;
    await retireWishlist(db);
    await emptyStore(db);
    beginWishlist(db);
    answer.resolve(outcome(ok));
    const result = await sent;
    assert.deepEqual(await counts(), { raw: 0, wishlist: 0 }, 'a late old exchange cannot write into the reused database');
    assert.equal(result, null, 'retirement suppresses its outcome before UI callbacks');
  });
}

test('retirement during a Page lookup stops before the account write', async (t) => {
  const { db, app, counts } = await fixture(t);
  const entered = deferred<void>();
  const answer = deferred<Awaited<ReturnType<typeof app.session.fetchReleasePage>>>();
  let writes = 0;
  app.session.fetchReleasePage = () => { entered.resolve(); return answer.promise; };
  app.session.collectItem = async () => { writes += 1; return outcome(true); };
  const sent = exchange(app, TARGET, 'add', wishlistLifetime(db));
  await entered.promise;
  await retireWishlist(db);
  await emptyStore(db);
  beginWishlist(db);
  answer.resolve({ kind: 'unreachable' });
  const result = await sent;
  assert.equal(writes, 0, 'the old account write has not entered the session and must not be started');
  assert.deepEqual(await counts(), { raw: 0, wishlist: 0 });
  assert.equal(result, null);
});

for (const stage of ['raw', 'membership'] as const) {
  test(`retirement drains an admitted ${stage} write before the same database is emptied`, async (t) => {
    const { db, app: initial, counts } = await fixture(t);
    let app = initial;
    const entered = deferred<void>();
    const release = deferred<void>();
    if (stage === 'raw') {
      const persist = app.putRaw;
      app = {
        ...app,
        putRaw: async (document) => {
          entered.resolve();
          await release.promise;
          return persist(document);
        },
      };
    } else {
      const run = db.runAsync.bind(db);
      mock.method(db, 'runAsync', async (...args: Parameters<typeof run>) => {
        if (args[0].includes('insert into wishlist_items')) {
          entered.resolve();
          await release.promise;
        }
        return run(...args);
      });
    }
    const sent = exchange(app, TARGET, 'add', wishlistLifetime(db));
    await entered.promise;
    let emptied = false;
    const removing = (async () => {
      await retireWishlist(db);
      await emptyStore(db);
      beginWishlist(db);
      emptied = true;
    })();
    await new Promise((resolve) => setImmediate(resolve));
    const emptiedEarly = emptied;
    release.resolve();
    const [result] = await Promise.all([sent, removing]);
    assert.equal(emptiedEarly, false, 'reset must wait for a local write already admitted by this lifetime');
    assert.deepEqual(await counts(), { raw: 0, wishlist: 0 }, 'the old local write completes before erasure, not after it');
    assert.equal(result, null, 'the retired write cannot publish an outcome after its local work drains');
  });
}

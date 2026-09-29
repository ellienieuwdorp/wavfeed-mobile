/// <reference types="node" />
/**
 * Error capture (task 0038 decision 10) over the real outbox on `node:sqlite`, with stand-ins for RN's `ErrorUtils`
 * and `HermesInternal`: the report is on disk before the previous handler runs, echoes of a fatal are not written,
 * the rejection tracker is release-only, and reports wait for the store and are kept only where it holds the yes.
 */
import assert from 'node:assert/strict';
import type { DatabaseSync } from 'node:sqlite';
import { beforeEach, describe, test } from 'node:test';
import type { SQLiteDatabase } from 'expo-sqlite';

import { openTestStore } from '../../test/nodeDb';
import type { ErrorReport } from './errorReport';
import { createErrorReports, installErrorCapture, type ErrorReports, type ErrorUtilsLike, type HermesLike } from './errors';
import { turnSharingOn } from './outbox';

const NOW = Date.UTC(2026, 8, 29, 12, 0, 0);
const INSTALL = '3b9f0c52-8a0e-4c2f-9a41-6f1d2b7e9c10';

let db: SQLiteDatabase;
let reports: ErrorReports;

async function written(): Promise<ErrorReport[]> {
  const rows = await db.getAllAsync<{ body: string }>("select body from tally_outbox where kind = 'error' order by seq");
  return rows.map((row) => JSON.parse(row.body) as ErrorReport);
}

/** Read synchronously, as a handler that ends the process would leave it. */
function writtenNow(): number {
  const { d } = db as unknown as { d: DatabaseSync };
  return (d.prepare("select count(*) as n from tally_outbox where kind = 'error'").get() as { n: number }).n;
}

/** RN's `ErrorUtils`: one slot, and the handler expo-router put there, which records what reached it. */
function errorUtils(): ErrorUtilsLike & { reached: [unknown, boolean | undefined, number][] } {
  const reached: [unknown, boolean | undefined, number][] = [];
  let handler: (error: unknown, isFatal?: boolean) => void = (error, isFatal) => void reached.push([error, isFatal, writtenNow()]);
  return { reached, getGlobalHandler: () => handler, setGlobalHandler: (next) => (handler = next) };
}

beforeEach(async () => {
  ({ db } = await openTestStore());
  await turnSharingOn(db, INSTALL, NOW);
  reports = createErrorReports(() => NOW);
  reports.setSink(db);
});

describe('the global handler', () => {
  test('writes the scrubbed report, then hands the same error on', async () => {
    const utils = errorUtils();
    installErrorCapture(reports, { errorUtils: utils, hermes: undefined, dev: false });
    reports.setScreen('player');
    const error = new TypeError('no release at https://x.bandcamp.com/album/y');
    error.stack = `${error.message}\n    at p (address at main.jsbundle:1:132161)`;
    utils.getGlobalHandler()(error, true);

    assert.deepEqual(utils.reached, [[error, true, 1]], 'the report was on disk before the previous handler ran');
    const [report] = await written();
    assert.deepEqual(
      { ...report, t: undefined },
      { t: undefined, source: 'global', fatal: true, code: null, name: 'TypeError', message: 'no release at <url>', screen: 'player', frames: [['p', 'main.jsbundle', 1, 132161]] },
    );
  });

  test("writes only a process's first fatal, and hands every error on", async () => {
    const utils = errorUtils();
    installErrorCapture(reports, { errorUtils: utils, hermes: undefined, dev: false });
    const handle = utils.getGlobalHandler();
    handle(new Error('first'), true);
    handle(new Error('echo'), true);
    handle(new Error('later'), false);
    assert.deepEqual((await written()).map((r) => r.message), ['first', 'later']);
    assert.equal(utils.reached.length, 3);
  });

  test('hands the error on when the store cannot take the report', () => {
    const utils = errorUtils();
    const broken = createErrorReports(() => NOW);
    broken.setSink({ runSync: () => { throw new Error('database is locked'); } } as unknown as SQLiteDatabase);
    installErrorCapture(broken, { errorUtils: utils, hermes: undefined, dev: false });
    utils.getGlobalHandler()(new Error('boom'), true);
    assert.equal(utils.reached.length, 1);
  });

  test('a second install, as Fast Refresh runs, still writes each error once', async () => {
    const utils = errorUtils();
    installErrorCapture(reports, { errorUtils: utils, hermes: undefined, dev: true });
    assert.equal(installErrorCapture(reports, { errorUtils: utils, hermes: undefined, dev: true }).handler, false);
    utils.getGlobalHandler()(new Error('once'), false);
    assert.equal((await written()).length, 1);
    assert.equal(utils.reached.length, 1);
  });
});

describe('the rejection tracker', () => {
  function hermes(): HermesLike & { options: unknown[] } {
    const options: unknown[] = [];
    return { options, enablePromiseRejectionTracker: (o) => void options.push(o) };
  }

  test('a release build tracks every rejection and writes each unhandled one', async () => {
    const tracker = hermes();
    assert.equal(installErrorCapture(reports, { errorUtils: undefined, hermes: tracker, dev: false }).rejections, true);
    const [options] = tracker.options as { allRejections: boolean; onUnhandled: (id: number, r: unknown) => void }[];
    assert.equal(options?.allRejections, true);
    options?.onUnhandled(4, new RangeError('offset 123456 out of range'));
    options?.onUnhandled(5, 'a bare string');
    assert.deepEqual(
      (await written()).map((r) => [r.source, r.fatal, r.name, r.message]),
      [
        ['promise', false, 'RangeError', 'offset <n> out of range'],
        ['promise', false, 'NonError', 'a bare string'],
      ],
    );
  });

  test('a development build leaves it to LogBox, and an engine without it is fine', () => {
    const tracker = hermes();
    assert.equal(installErrorCapture(reports, { errorUtils: undefined, hermes: tracker, dev: true }).rejections, false);
    assert.equal(tracker.options.length, 0);
    assert.equal(installErrorCapture(reports, { errorUtils: undefined, hermes: {}, dev: false }).rejections, false);
    assert.equal(installErrorCapture(reports, { errorUtils: undefined, hermes: null, dev: false }).rejections, false);
  });
});

describe('before the store opens', () => {
  test('reports wait for it, then are kept only if it holds the yes', async () => {
    const { db: refused } = await openTestStore();
    for (const [store, kept] of [
      [db, 1],
      [refused, 0],
    ] as const) {
      const early = createErrorReports(() => NOW);
      early.report(new Error('replay failed'), 'code', false, 'projection_replay_failed');
      early.setSink(store);
      const rows = await store.getAllAsync<{ body: string }>("select body from tally_outbox where kind = 'error'");
      assert.equal(rows.length, kept);
    }
    assert.deepEqual((await written()).map((r) => [r.source, r.code]), [['code', 'projection_replay_failed']]);
  });

  test('a store being removed takes nothing, and the next one only what came after', async () => {
    const early = createErrorReports(() => NOW);
    early.report(new Error('before the store opened'), 'global', false);
    early.setSink(null);
    early.report(new Error('while it was removed'), 'global', false);
    early.setSink(db);
    early.report(new Error('after'), 'global', false);
    assert.deepEqual((await written()).map((r) => r.message), ['after']);
  });
});

test('a boundary writes an error React hands it twice once', async () => {
  const error = new Error('render failed');
  reports.reportCaught(error);
  reports.reportCaught(error);
  reports.reportCaught('thrown text');
  assert.deepEqual((await written()).map((r) => [r.source, r.fatal, r.message]), [
    ['boundary', false, 'render failed'],
    ['boundary', false, 'thrown text'],
  ]);
});

/// <reference types="node" />
/**
 * The sender (task 0038) on the real migrations over `node:sqlite` against a fake ingest Worker: nothing posted
 * without a yes, the outbox drained in Worker-sized batches, a wait kept and backed off, an off mid-flight obeyed, and
 * one flush in flight however many reasons arrive.
 */
import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';
import type { SQLiteDatabase } from 'expo-sqlite';

import { openTestStore } from '../../test/nodeDb';
import type { Tally } from './catalogue';
import { enqueueTally, readDropped, turnSharingOff, turnSharingOn } from './outbox';
import { fetchPost, flush, IDLE, onSettled, onTrigger, Sender, type FlushDeps, type Post, type SenderDeps } from './send';
import type { BatchBody } from './wire';

const NOW = Date.UTC(2026, 8, 29, 12, 0, 0);
const INSTALL = '3b9f0c52-8a0e-4c2f-9a41-6f1d2b7e9c10';
const OPENED: Tally = { name: 'app_opened', props: { launch: 'cold' } };
const CTX = { schema: 2, version: '1.0.0', build: '37', update: 'embedded', env: 'development', platform: 'ios', os: 26, channel: null } as const;
const at = (t: number) => ({ t, signedIn: false, walkDone: false });

let db: SQLiteDatabase;
let ids: number;
const newId = (): string => `00000000-0000-4000-8000-${String(++ids).padStart(12, '0')}`;

type Answer = { status: number; retryAfter: string | null } | null;

/** Records every body; answers each post with the next scripted answer, then 200. */
function worker(script: Answer[] = []) {
  const bodies: BatchBody[] = [];
  const post: Post = async (_url, body) => {
    bodies.push(JSON.parse(body) as BatchBody);
    return script.length > 0 ? (script.shift() ?? null) : { status: 200, retryAfter: null };
  };
  return { bodies, post };
}

function deps(post: Post, install = INSTALL): FlushDeps {
  return { db, url: 'http://localhost:8787/v1/batch', key: 'wf_dev_local', install, ctx: CTX, post, now: () => NOW, newId, at: () => at(NOW) };
}

async function queue(count: number): Promise<void> {
  for (let i = 0; i < count; i += 1) await enqueueTally(db, OPENED, at(NOW + i));
}

async function rows(): Promise<number> {
  return (await db.getFirstAsync<{ n: number }>('select count(*) as n from tally_outbox'))?.n ?? 0;
}

const live = () => new AbortController().signal;

beforeEach(async () => {
  ({ db } = await openTestStore());
  ids = 0;
});

describe('flush', () => {
  test('without a yes nothing is posted', async () => {
    await queue(30);
    const w = worker();
    assert.deepEqual(await flush(deps(w.post), live()), { kind: 'stopped' });
    assert.equal(w.bodies.length, 0);
  });

  test('250 queued go out as 100, 100 and 50 with the envelope, and the outbox ends empty', async () => {
    await turnSharingOn(db, INSTALL, NOW);
    await queue(250);
    const w = worker();
    assert.deepEqual(await flush(deps(w.post), live()), { kind: 'done', batches: 3 });
    assert.deepEqual(w.bodies.map((b) => b.tallies.length), [100, 100, 50]);
    assert.equal(new Set(w.bodies.map((b) => b.batch)).size, 3);
    for (const body of w.bodies) {
      assert.deepEqual(Object.keys(body).sort(), ['batch', 'ctx', 'errors', 'install', 'key', 'sent_at', 'tallies', 'v']);
      assert.equal(body.install, INSTALL);
      assert.deepEqual(body.ctx, CTX);
    }
    assert.equal(await rows(), 0);
  });

  test('a 429 keeps the batch and hands back the Retry-After; the retry reuses the batch id', async () => {
    await turnSharingOn(db, INSTALL, NOW);
    await queue(5);
    const w = worker([{ status: 429, retryAfter: '60' }]);
    assert.deepEqual(await flush(deps(w.post), live()), { kind: 'retry', retryAfter: 60_000 });
    assert.equal(await rows(), 5);
    assert.deepEqual(await flush(deps(w.post), live()), { kind: 'done', batches: 1 });
    assert.equal(w.bodies[0]?.batch, w.bodies[1]?.batch);
    assert.equal(await rows(), 0);
  });

  test('no answer at all is a retry with no floor', async () => {
    await turnSharingOn(db, INSTALL, NOW);
    await queue(1);
    assert.deepEqual(await flush(deps(worker([null]).post), live()), { kind: 'retry', retryAfter: 0 });
    assert.equal(await rows(), 1);
  });

  test('a refused batch is dropped, and the count goes out as tallies_dropped on the next flush', async () => {
    await turnSharingOn(db, INSTALL, NOW);
    await queue(3);
    const w = worker([{ status: 400, retryAfter: null }]);
    assert.deepEqual(await flush(deps(w.post), live()), { kind: 'done', batches: 1 });
    assert.equal((await readDropped(db)).refused, 0, 'the counter moved into a Tally');
    await flush(deps(w.post), live());
    assert.deepEqual(w.bodies[1]?.tallies.map((t) => [t[1], t[3]]), [['tallies_dropped', { reason: 'refused', dropped: '2 to 5' }]]);
  });

  test('an off while a batch is in flight stops the flush and a new yes is never sent under the old id', async () => {
    await turnSharingOn(db, INSTALL, NOW);
    await queue(150);
    const controller = new AbortController();
    const bodies: BatchBody[] = [];
    const post: Post = async (_url, body) => {
      bodies.push(JSON.parse(body) as BatchBody);
      await turnSharingOff(db);
      await turnSharingOn(db, newId(), NOW);
      await enqueueTally(db, OPENED, at(NOW));
      return { status: 200, retryAfter: null };
    };
    assert.deepEqual(await flush(deps(post), controller.signal), { kind: 'stopped' });
    assert.equal(bodies.length, 1);
    assert.equal(await rows(), 1, 'the new Install keeps its own row');
  });

  test('an off that lands while a batch is being taken stops the flush before anything is posted', async () => {
    await turnSharingOn(db, INSTALL, NOW);
    await queue(3);
    const controller = new AbortController();
    const w = worker();
    // The press that turns sharing off aborts the flush and deletes the rows while the take is still reading them.
    const taking = new Proxy(db, {
      get(target, prop, receiver) {
        const value = Reflect.get(target, prop, receiver) as unknown;
        if (prop !== 'getAllAsync' || typeof value !== 'function') return typeof value === 'function' ? value.bind(target) : value;
        return async (...args: unknown[]) => {
          const read = await (value as (...a: unknown[]) => Promise<unknown>).apply(target, args);
          controller.abort();
          await turnSharingOff(target);
          return read;
        };
      },
    });
    assert.deepEqual(await flush({ ...deps(w.post), db: taking }, controller.signal), { kind: 'stopped' });
    assert.equal(w.bodies.length, 0);
  });

  test('an abort mid-request stops without settling', async () => {
    await turnSharingOn(db, INSTALL, NOW);
    await queue(2);
    const controller = new AbortController();
    const post: Post = async () => {
      controller.abort();
      return { status: 200, retryAfter: null };
    };
    assert.deepEqual(await flush(deps(post), controller.signal), { kind: 'stopped' });
    assert.equal(await rows(), 2);
  });
});

describe('the schedule', () => {
  test('a trigger starts a flush, and one during it asks for one more after', () => {
    const first = onTrigger(IDLE, NOW);
    assert.equal(first.start, true);
    const second = onTrigger(first.schedule, NOW);
    assert.equal(second.start, false);
    const after = onSettled(second.schedule, { kind: 'done', batches: 1 }, NOW, () => 1);
    assert.equal(after.start, true);
    assert.equal(onSettled(after.schedule, { kind: 'done', batches: 0 }, NOW, () => 1).start, false);
  });

  test('a retry backs off with growing ceilings, a trigger inside the wait only wakes at its end, and a send resets it', () => {
    let s = onTrigger(IDLE, NOW).schedule;
    const waits: number[] = [];
    for (let i = 0; i < 4; i += 1) {
      const move = onSettled(s, { kind: 'retry', retryAfter: 0 }, NOW, () => 1);
      waits.push((move.wakeAt ?? 0) - NOW);
      const early = onTrigger(move.schedule, NOW + 1);
      assert.deepEqual([early.start, early.wakeAt], [false, move.wakeAt]);
      s = onTrigger(move.schedule, move.wakeAt ?? 0).schedule;
    }
    assert.deepEqual(waits, [5_000, 10_000, 20_000, 40_000]);
    assert.deepEqual(onSettled(s, { kind: 'done', batches: 1 }, NOW, () => 1).schedule, IDLE);
  });

  test('a stopped flush leaves nothing pending', () => {
    const running = onTrigger(onTrigger(IDLE, NOW).schedule, NOW).schedule;
    assert.deepEqual(onSettled(running, { kind: 'stopped' }, NOW, () => 1), { schedule: IDLE, start: false, wakeAt: null });
  });
});

describe('Sender', () => {
  function sender(post: Post) {
    const timers: { run: () => void; ms: number }[] = [];
    const d: SenderDeps = { ...deps(post), random: () => 1, setTimer: (run, ms) => timers.push({ run, ms }), clearTimer: () => undefined };
    return { s: new Sender(d), timers };
  }

  test('any number of reasons at once keep one request in flight', async () => {
    await turnSharingOn(db, INSTALL, NOW);
    await queue(250);
    let inFlight = 0;
    let most = 0;
    const post: Post = async () => {
      inFlight += 1;
      most = Math.max(most, inFlight);
      await new Promise((done) => setImmediate(done));
      inFlight -= 1;
      return { status: 200, retryAfter: null };
    };
    const { s } = sender(post);
    for (let i = 0; i < 5; i += 1) s.request();
    await s.settle(1_000);
    await s.settle(1_000);
    assert.equal(most, 1);
    assert.equal(await rows(), 0);
  });

  test('20 queued rows ask for a flush; 19 do not', async () => {
    await turnSharingOn(db, INSTALL, NOW);
    const w = worker();
    const { s } = sender(w.post);
    await queue(19);
    await s.queued();
    assert.equal(w.bodies.length, 0);
    await queue(1);
    await s.queued();
    await s.settle(1_000);
    assert.equal(w.bodies.length, 1);
  });

  test('a failed try sets a wake-up timer, and after dispose nothing is sent', async () => {
    await turnSharingOn(db, INSTALL, NOW);
    await queue(1);
    const w = worker([{ status: 503, retryAfter: null }]);
    const { s, timers } = sender(w.post);
    await s.settle(1_000);
    const wake = timers.find((t) => t.ms === 5_000);
    assert.ok(wake, JSON.stringify(timers.map((t) => t.ms)));
    s.dispose();
    wake.run();
    await new Promise((done) => setImmediate(done));
    assert.equal(w.bodies.length, 1);
  });
});

describe('fetchPost', () => {
  function recorder() {
    const calls: { url: string; init: RequestInit }[] = [];
    const send = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response('{"ok":true}', { status: 200, headers: { 'retry-after': '60' } });
    }) as unknown as typeof fetch;
    return { calls, post: fetchPost(send) };
  }

  test('posts the body with no cookies and only headers it names itself', async () => {
    const { calls, post } = recorder();
    assert.deepEqual(await post('http://localhost:8787/v1/batch', '{}', live()), { status: 200, retryAfter: '60' });
    assert.equal(calls.length, 1);
    const init = calls[0]?.init;
    assert.equal(init?.method, 'POST');
    assert.equal(init?.credentials, 'omit');
    assert.deepEqual(init?.headers, { 'content-type': 'application/json', 'accept-language': '*', 'user-agent': 'wavfeed' });
  });

  test('a signal that fired before the call sends nothing', async () => {
    const { calls, post } = recorder();
    const controller = new AbortController();
    controller.abort();
    assert.equal(await post('http://localhost:8787/v1/batch', '{}', controller.signal), null);
    assert.equal(calls.length, 0);
  });
});

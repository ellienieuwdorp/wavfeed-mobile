/**
 * The outbox sender (the plan's "The outbox is migration 4"): `flush` posts batches for one Install until
 * the outbox is empty or the Worker asks for a wait, and a `Sender` holds one flush in flight at a time. A trigger
 * during a flush runs one more after it; a trigger during a back-off waits for its end. The back-off grows with each
 * failed try and takes the Worker's `Retry-After` as a floor (`backoffMs`). A flush re-reads the sharing row before
 * each batch and stops when it no longer holds this Install, and `dispose` aborts the request in flight, so an off or
 * a removed store ends the sending at once. Time, ids, randomness, timers and the request are arguments.
 */
import type { SQLiteDatabase } from 'expo-sqlite';

import { backoffMs, countQueued, enqueueDropped, readDropped, readSharing, retryAfterMs, settleBatch, takeBatch, verdict } from './outbox';
import { batchBody, type TallyAt, type TallyContext } from './wire';

/** ceiling: 20 queued rows or every 60 s while active, the PostHog and Segment defaults; tune from the board's batch sizes. */
export const FLUSH_AT_ROWS = 20;
export const FLUSH_EVERY_MS = 60_000;
export const REQUEST_TIMEOUT_MS = 10_000;
/** How long "Remove everything gathered" waits for `store_removed` to go before the file goes. */
export const REMOVE_FLUSH_MS = 3_000;

/** The one network call: `fetch` in the app, a fake Worker in tests. Resolves with no answer on any failure. */
export type Post = (url: string, body: string, signal: AbortSignal) => Promise<{ status: number; retryAfter: string | null } | null>;

export type FlushDeps = {
  readonly db: SQLiteDatabase;
  readonly url: string;
  readonly key: string;
  readonly install: string;
  readonly ctx: TallyContext;
  readonly post: Post;
  readonly now: () => number;
  readonly newId: () => string;
  /** When and under which flags a `tallies_dropped` is queued. */
  readonly at: () => TallyAt;
};

export type FlushResult =
  | { readonly kind: 'done'; readonly batches: number }
  | { readonly kind: 'retry'; readonly retryAfter: number }
  | { readonly kind: 'stopped' };

export async function flush(deps: FlushDeps, signal: AbortSignal): Promise<FlushResult> {
  const { db } = deps;
  let batches = 0;
  for (;;) {
    if (signal.aborted || (await readSharing(db))?.install !== deps.install) return { kind: 'stopped' };
    if ((await countQueued(db)) === 0) break;
    const taken = await takeBatch(db, deps.newId, deps.now());
    if (taken === null) break;
    // An off or a removed store during the take lands here: the rows read before it never leave.
    if (signal.aborted || (await readSharing(db))?.install !== deps.install) return { kind: 'stopped' };
    const body = batchBody({ key: deps.key, install: deps.install, batch: taken.batch, sentAt: deps.now(), ctx: deps.ctx }, taken.rows);
    const answer = await deps.post(deps.url, JSON.stringify(body), signal);
    if (signal.aborted) return { kind: 'stopped' };
    const outcome = verdict(answer === null ? 'network' : answer.status);
    await settleBatch(db, taken.batch, outcome);
    if (outcome === 'retry') return { kind: 'retry', retryAfter: retryAfterMs(answer?.retryAfter ?? null) };
    batches += 1;
  }
  const dropped = await readDropped(db);
  if (dropped.full + dropped.old + dropped.refused > 0) await enqueueDropped(db, deps.at());
  return { kind: 'done', batches };
}

/** `attempt` counts the tries that failed in a row; nothing starts before `notBefore`. */
export type Schedule = { readonly running: boolean; readonly again: boolean; readonly attempt: number; readonly notBefore: number };
export const IDLE: Schedule = { running: false, again: false, attempt: 0, notBefore: 0 };

export type Move = { readonly schedule: Schedule; readonly start: boolean; readonly wakeAt: number | null };

export function onTrigger(s: Schedule, now: number): Move {
  if (s.running) return { schedule: { ...s, again: true }, start: false, wakeAt: null };
  if (now < s.notBefore) return { schedule: s, start: false, wakeAt: s.notBefore };
  return { schedule: { ...s, running: true, again: false }, start: true, wakeAt: null };
}

export function onSettled(s: Schedule, result: FlushResult, now: number, random: () => number): Move {
  if (result.kind === 'retry') {
    const notBefore = now + backoffMs(s.attempt, random, result.retryAfter);
    return { schedule: { running: false, again: false, attempt: s.attempt + 1, notBefore }, start: false, wakeAt: notBefore };
  }
  if (result.kind === 'done' && s.again) return { schedule: { ...IDLE, running: true }, start: true, wakeAt: null };
  return { schedule: IDLE, start: false, wakeAt: null };
}

export type SenderDeps = FlushDeps & {
  readonly random: () => number;
  readonly setTimer: (run: () => void, ms: number) => unknown;
  readonly clearTimer: (timer: unknown) => void;
};

export class Sender {
  private schedule: Schedule = IDLE;
  private timer: unknown = null;
  private running: Promise<void> | null = null;
  private controller: AbortController | null = null;
  private disposed = false;
  private readonly deps: SenderDeps;

  constructor(deps: SenderDeps) {
    this.deps = deps;
  }

  /** A reason to send: launch, foreground, background, the minute tick or a full enough outbox. */
  request(): void {
    if (this.disposed) return;
    this.apply(onTrigger(this.schedule, this.deps.now()));
  }

  /** After a Tally is queued: flushes early once `FLUSH_AT_ROWS` wait. */
  async queued(): Promise<void> {
    if (!this.disposed && (await countQueued(this.deps.db)) >= FLUSH_AT_ROWS) this.request();
  }

  /** Requests a flush and waits for it, at most `ms`. */
  async settle(ms: number): Promise<void> {
    this.request();
    let timer: unknown = null;
    await Promise.race([this.running ?? Promise.resolve(), new Promise<void>((done) => (timer = this.deps.setTimer(done, ms)))]);
    this.deps.clearTimer(timer);
  }

  dispose(): void {
    this.disposed = true;
    this.controller?.abort();
    if (this.timer !== null) this.deps.clearTimer(this.timer);
    this.timer = null;
  }

  private apply(move: Move): void {
    this.schedule = move.schedule;
    if (move.wakeAt !== null && this.timer === null) {
      this.timer = this.deps.setTimer(() => {
        this.timer = null;
        this.request();
      }, Math.max(0, move.wakeAt - this.deps.now()));
    }
    if (move.start) this.running = this.run();
  }

  private async run(): Promise<void> {
    const controller = new AbortController();
    this.controller = controller;
    let result: FlushResult;
    try {
      result = await flush(this.deps, controller.signal);
    } catch {
      result = { kind: 'retry', retryAfter: 0 };
    }
    this.controller = null;
    this.running = null;
    if (this.disposed) return;
    this.apply(onSettled(this.schedule, result, this.deps.now(), this.deps.random));
  }
}

/** `fetch` as the house sends public calls: no cookies, a JSON body and a 10 s ceiling (`mobile/src/bandcamp/session.ts`). */
export function fetchPost(send: typeof fetch): Post {
  return async (url, body, signal) => {
    // A listener added to a signal that has already fired never runs, so an abort before the call is checked here.
    if (signal.aborted) return null;
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal.addEventListener('abort', abort);
    const timer = setTimeout(abort, REQUEST_TIMEOUT_MS);
    try {
      const response = await send(url, {
        method: 'POST',
        credentials: 'omit',
        // Named so the platform adds none of its own: iOS would send the phone's languages and its Darwin build.
        headers: { 'content-type': 'application/json', 'accept-language': '*', 'user-agent': 'wavfeed' },
        body,
        signal: controller.signal,
      });
      await response.text().catch(() => '');
      return { status: response.status, retryAfter: response.headers.get('retry-after') };
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
    }
  };
}

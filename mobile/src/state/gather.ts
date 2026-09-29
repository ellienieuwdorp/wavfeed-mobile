/**
 * The gather runner the app state calls (task 0036, decision 4): one chain of turns at a time over the store's sink, a
 * minute's budget when the app opens or the timer fires and two when the person pulls to refresh, and the schedule's
 * answer to whether a turn is due: always while the first walk is pending or a cursor is held, else once the last turn
 * is fifteen minutes old.
 * A phone signed out from Settings holds `not_connected` and runs no turn until Connect clears it, so its probe cannot
 * turn the person's own sign-out into Bandcamp's.
 */
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { useCallback, useEffect } from 'react';

import { dueFrom, useGatherSchedule, type Due } from '@/fetcher/schedule';
import type { GatherState } from '@/fetcher/sink';
import { runGatherTurn, type GatherReason, type TurnSummary } from '@/fetcher/turn';
import { readKv } from '@/store';

import { useAppState, type AppState, type RunnerDeps } from './appState';
import { createGatherSink, GATHER_KEY, readStoredIdentity, WALK_KEY } from './gatherSink';

export const BUDGET_MS: Readonly<Record<GatherReason, number>> = { open: 60_000, timer: 60_000, refresh: 120_000 };

let running: Promise<TurnSummary> | null = null;
let chain: Promise<void> | null = null;

async function signedOutHere(app: RunnerDeps): Promise<boolean> {
  const state = await readKv<Partial<GatherState>>(app.db, GATHER_KEY);
  return state?.pausedReason === 'not_connected' && (await readStoredIdentity(app.db)) !== null;
}

/** While the first walk is still pending, turns chain back to back so the history fills in one sitting. */
export const MAX_CHAINED_TURNS = 12;
/**
 * A walk turn that failed unanswered or on the store retries twice, in case the first request after a wake fails
 * (unconfirmed). One that Bandcamp failed with a status does not: a 403, 429 or 5xx asks for fewer requests (ADR-0017).
 */
export const FAILED_RETRIES = 2;
export const RETRY_AFTER_MS = 10_000;

export async function runner(reason: GatherReason, app: RunnerDeps): Promise<void> {
  // A caller arriving mid-chain waits for the turn on the wire, not the whole chain, then re-reads the store.
  if (chain !== null) {
    await running?.catch(() => undefined);
    app.invalidate();
    return;
  }
  chain = runChain(reason, app).finally(() => {
    chain = null;
  });
  await chain;
}

async function runChain(reason: GatherReason, app: RunnerDeps): Promise<void> {
  if (await signedOutHere(app)) return;
  const sink = createGatherSink(app);
  let retries = 0;
  for (let turn = 0; turn < MAX_CHAINED_TURNS; turn += 1) {
    running = runGatherTurn(app.session, sink, { now: Date.now, reason, budgetMs: BUDGET_MS[reason] }).finally(() => {
      running = null;
    });
    const summary = await running;
    console.log('gather turn:', summary.reason, summary.outcome, 'status', summary.status, 'walk pending', summary.walkPending);
    app.invalidate();
    if (summary.outcome === 'failed' && summary.status === null && summary.walkPending && retries < FAILED_RETRIES) {
      retries += 1;
      await new Promise((resolve) => setTimeout(resolve, RETRY_AFTER_MS));
      continue;
    }
    if (summary.outcome !== 'out_of_budget' || !summary.walkPending) return;
  }
}

/** Waits out a turn already on the wire, so a wake that lands mid-turn decides on what that turn left behind. */
export async function readDue(db: AppState['db'], now: number): Promise<Due> {
  const waited = running !== null;
  await running?.catch(() => undefined);
  const walkHeld = (await readKv(db, WALK_KEY)) !== null;
  const state = await readKv<Partial<GatherState>>(db, GATHER_KEY);
  // A paused store is not walking; its fifteen-minute probe is how it notices a sign-in.
  const firstWalk = state?.initialWalkDone !== true && (state?.pausedReason ?? null) === null;
  return dueFrom(walkHeld || firstWalk, state?.lastTurnAt ?? null, waited ? Date.now() : now);
}

/** The turn on the wire, if any, for a press that must wait for it (removing the store). */
export function turnRunning(): Promise<TurnSummary> | null {
  return running;
}

/** Mounted once under the app state; renders nothing. */
export function GatherSchedule() {
  const { db, runGather, gather } = useAppState();
  const due = useCallback((now: number) => readDue(db, now), [db]);
  useGatherSchedule(runGather, due);
  // iOS suspends a locked phone, so the screen stays on while a turn runs and the first walk is still pending.
  const busy = gather.phase !== 'idle';
  useEffect(() => {
    if (!busy) return;
    void activateKeepAwakeAsync(KEEP_AWAKE_TAG);
    return () => {
      void deactivateKeepAwake(KEEP_AWAKE_TAG);
    };
  }, [busy]);
  return null;
}

const KEEP_AWAKE_TAG = 'wavfeed-gather';

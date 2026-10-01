/**
 * The gather runner the app state calls (task 0036, decision 4): one chain of turns at a time over the store's sink, a
 * minute's budget when the app opens or the timer fires and two when the person pulls to refresh, and the schedule's
 * answer to whether a turn is due: always while the first walk is pending or a cursor is held, else once the last turn
 * is fifteen minutes old. While the first walk is pending, turns chain back to back with no count cap for as long as
 * the app is in the foreground, and stop once `STALL_TURNS` in a row leave the stored walk where it was (task 0040).
 * A phone signed out from Settings holds `not_connected` and runs no turn until Connect clears it, so its probe cannot
 * turn the person's own sign-out into Bandcamp's. Each chain that ran a turn ends in its gather Tallies, and each fold
 * that skipped something in `projection_skipped` (task 0038). A store holding the Demo runs no
 * turn either (task 0043, decision 7).
 */
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { useCallback, useEffect } from 'react';
import { AppState as NativeAppState } from 'react-native';

import { isDemoFan } from '@/demo/demo';
import { dueFrom, useGatherSchedule, type Due } from '@/fetcher/schedule';
import type { GatherSink, GatherState, WalkState } from '@/fetcher/sink';
import { bandDetailsBreaker } from '@/fetcher/sweep';
import { runGatherTurn, type GatherReason, type TurnSummary } from '@/fetcher/turn';
import { devLog } from '@/lib/devLog';
import { readChainCounts, readKv } from '@/store';
import { gatherTallies, projectionSkipped, type ChainFacts } from '@/tally/tally';

import { useAppState, type AppState, type RunnerDeps } from './appState';
import { createGatherSink, GATHER_KEY, readStoredIdentity, readStoredWalk, WALK_KEY } from './gatherSink';

export const BUDGET_MS: Readonly<Record<GatherReason, number>> = { open: 60_000, timer: 60_000, refresh: 120_000 };

let running: Promise<TurnSummary> | null = null;
let chain: Promise<void> | null = null;

/** Signed out from Settings, or the Demo: either way no probe may run. */
async function holdsNoTurn(app: RunnerDeps): Promise<boolean> {
  const identity = await readStoredIdentity(app.db);
  if (isDemoFan(identity?.fanId)) return true;
  const state = await readKv<Partial<GatherState>>(app.db, GATHER_KEY);
  return state?.pausedReason === 'not_connected' && identity !== null;
}

/** Turns in a row that leave the stored walk as it was, cursor and depth probe alike, after which the chain stops. */
export const STALL_TURNS = 3;
/**
 * A walk turn that failed unanswered or on the store retries twice, in case the first request after a wake fails
 * (unconfirmed). One that Bandcamp failed with a status does not: a 403, 429 or 5xx asks for fewer requests (ADR-0017).
 * A turn that moves the walk gives the retries back (task 0040).
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
  // A store closed under the chain (Remove all) ends it here, as a store error ends a turn inside `runGatherTurn`.
  chain = runChain(reason, app)
    .catch((error: unknown) => {
      console.warn('gather chain stopped on the store:', error instanceof Error ? error.message : String(error));
    })
    .finally(() => {
      chain = null;
    });
  await chain;
}

async function runChain(reason: GatherReason, app: RunnerDeps): Promise<void> {
  if (await holdsNoTurn(app)) return;
  const sink = createGatherSink({
    ...app,
    onFold: (skipped) => {
      const tally = projectionSkipped(skipped);
      if (tally !== null) app.track(tally);
    },
  });
  const startedAt = Date.now();
  const before = await sink.readGatherState();
  const walkAtStart = await readStoredWalk(app.db);
  const openingsAtStart = bandDetailsBreaker.openings;
  const run = await runTurns(reason, app, sink);
  if (run === null) return;
  // One `gather_finished` per chain, after `sync_run_finished` when this chain ended the first walk (task 0038).
  const endedAt = Date.now();
  const after = await sink.readGatherState();
  const counts = await readChainCounts(app.db, new Date(startedAt));
  const facts: ChainFacts = {
    reason,
    ...run,
    startedAt,
    endedAt,
    walkAtStart,
    ...counts,
    sweepBreakerOpened: bandDetailsBreaker.openings > openingsAtStart,
  };
  for (const tally of gatherTallies(before, after, facts)) app.track(tally);
}

type ChainRun = Pick<ChainFacts, 'last' | 'turns' | 'retries'>;

/** The chain's turns, with the last one's summary and the failed-turn retries it spent; null only if none ran. */
async function runTurns(reason: GatherReason, app: RunnerDeps, sink: GatherSink): Promise<ChainRun | null> {
  let last: TurnSummary | null = null;
  let turns = 0;
  let retriesUsed = 0;
  let retries = 0;
  let stalled = 0;
  const ran = (): ChainRun | null => (last === null ? null : { last, turns, retries: retriesUsed });
  for (let turn = 0; ; turn += 1) {
    // iOS freezes JS in the background and Android gathers in the foreground only (task 0036, decision 4), so a chain
    // ends when the app leaves the foreground and the schedule's 'open' wake resumes it (task 0040). A sign-out from
    // Settings mid-chain ends it too, before the next probe can turn it into Bandcamp's.
    if (turn > 0 && (NativeAppState.currentState !== 'active' || (await holdsNoTurn(app)))) return ran();
    const before = await walkSpot(app.db);
    running = runGatherTurn(app.session, sink, { now: Date.now, reason, budgetMs: BUDGET_MS[reason] }).finally(() => {
      running = null;
    });
    const summary = await running;
    last = summary;
    turns += 1;
    devLog('gather turn:', summary.reason, summary.outcome, 'status', summary.status, 'walk pending', summary.walkPending);
    app.invalidate();
    // A chain with no count cap ends once turns stop moving the walk; a turn that moved it resets the stall run and
    // gives the retries back (task 0040).
    if ((await walkSpot(app.db)) === before) stalled += 1;
    else {
      stalled = 0;
      retries = 0;
    }
    if (stalled >= STALL_TURNS) return ran();
    if (summary.outcome === 'failed' && summary.status === null && summary.walkPending && retries < FAILED_RETRIES) {
      retries += 1;
      retriesUsed += 1;
      await new Promise((resolve) => setTimeout(resolve, RETRY_AFTER_MS));
      continue;
    }
    if (summary.outcome !== 'out_of_budget' || !summary.walkPending) return ran();
  }
}

/** The stored walk's cursor, page count and depth probe bounds as one comparable key, or null while no walk is held. */
async function walkSpot(db: AppState['db']): Promise<string | null> {
  const walk = await readKv<Partial<WalkState>>(db, WALK_KEY);
  return walk === null
    ? null
    : `${walk.olderThan}:${walk.pagesDone}:${walk.probed}:${walk.probeLower}:${walk.probeOldest?.length}`;
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

/**
 * The gather runner the app state calls (task 0036, decision 4): one turn at a time over the store's sink, a minute's
 * budget when the app opens or the timer fires and two when the person pulls to refresh, and the schedule that runs a
 * turn on open once the last is fifteen minutes old and every fifteen minutes while the app stays active. A phone
 * signed out from Settings holds `not_connected` and runs no turn until Connect clears it, so its probe cannot turn
 * the person's own sign-out into Bandcamp's.
 */
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { useCallback, useEffect } from 'react';

import { useGatherSchedule } from '@/fetcher/schedule';
import type { GatherState } from '@/fetcher/sink';
import { runGatherTurn, type GatherReason, type TurnSummary } from '@/fetcher/turn';
import { readKv } from '@/store';

import { useAppState, type AppState } from './appState';
import { createGatherSink, GATHER_KEY, readStoredIdentity, WALK_KEY } from './gatherSink';

export const BUDGET_MS: Readonly<Record<GatherReason, number>> = { open: 60_000, timer: 60_000, refresh: 120_000 };

let running: Promise<TurnSummary> | null = null;

async function signedOutHere(app: AppState): Promise<boolean> {
  const state = await readKv<Partial<GatherState>>(app.db, GATHER_KEY);
  return state?.pausedReason === 'not_connected' && (await readStoredIdentity(app.db)) !== null;
}

/** While the first walk is still pending, turns chain back to back so the history fills in one sitting. */
export const MAX_CHAINED_TURNS = 12;

export async function runner(reason: GatherReason, app: AppState): Promise<void> {
  if (running !== null) {
    await running;
    app.invalidate();
    return;
  }
  if (await signedOutHere(app)) return;
  const sink = createGatherSink(app);
  for (let turn = 0; turn < MAX_CHAINED_TURNS; turn += 1) {
    running = runGatherTurn(app.session, sink, { now: Date.now, reason, budgetMs: BUDGET_MS[reason] }).finally(() => {
      running = null;
    });
    const summary = await running;
    app.invalidate();
    if (summary.outcome !== 'out_of_budget' || !summary.walkPending || reason === 'timer') return;
  }
}

/** The turn on the wire, if any, for a press that must wait for it (removing the store). */
export function turnRunning(): Promise<TurnSummary> | null {
  return running;
}

/** Mounted once under the app state; renders nothing. */
export function GatherSchedule() {
  const { db, runGather, gather } = useAppState();
  // A walk still holding its cursor resumes on every open; the fifteen-minute rule is for a caught-up feed.
  const readLastTurnAt = useCallback(async () => {
    if ((await readKv(db, WALK_KEY)) !== null) return null;
    return (await readKv<Partial<GatherState>>(db, GATHER_KEY))?.lastTurnAt ?? null;
  }, [db]);
  useGatherSchedule(runGather, readLastTurnAt);
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

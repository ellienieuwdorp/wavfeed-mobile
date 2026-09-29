/**
 * Pull to refresh on a collection tab (task 0036, decision 4): a refresh turn, with the native spinner held until the
 * feed step lands (the turn moves `lastSuccessAt`, so "Updated just now" and the spinner change in one render), the
 * turn returns, or a ceiling passes. Release pages and the sweep after the feed run on without it. A refresh during
 * the first walk joins a chain of turns that can run for minutes, and the catch-up line already says so, so the
 * spinner lets go after a beat there.
 */
import { useCallback, useState } from 'react';

import { useAppState } from './appState';

// ceiling: the ceiling is a timer for a feed step that never lands; a runner that reports its steps could replace it.
const SPINNER_CEILING_MS = 20_000;
const CATCHING_UP_SPINNER_MS = 1_500;

export function useRefresh(): { refreshing: boolean; onRefresh: () => void } {
  const { runGather, gather } = useAppState();
  const [pull, setPull] = useState<{ readonly from: number | null } | null>(null);
  const walkDone = gather.initialWalkDone;
  const lastSuccessAt = gather.lastSuccessAt;
  const onRefresh = useCallback(() => {
    const mine = { from: lastSuccessAt };
    setPull(mine);
    const ceiling = new Promise<void>((resolve) => setTimeout(resolve, walkDone ? SPINNER_CEILING_MS : CATCHING_UP_SPINNER_MS));
    // Only this pull's own end clears it, so an earlier pull's ceiling cannot cut a later one short.
    void Promise.race([runGather('refresh').catch(() => undefined), ceiling]).finally(() => setPull((held) => (held === mine ? null : held)));
  }, [runGather, walkDone, lastSuccessAt]);
  return { refreshing: pull !== null && lastSuccessAt === pull.from, onRefresh };
}

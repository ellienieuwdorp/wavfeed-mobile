/**
 * Pull to refresh on a collection tab (task 0036, decision 4): a refresh turn, with the native spinner held until the
 * turn returns or a ceiling passes. A refresh during the first walk joins a chain of turns that can run for minutes,
 * and the catch-up line already says so, so the spinner lets go after a beat there.
 */
import { useCallback, useState } from 'react';

import { useAppState } from './appState';

// ceiling: the ceiling is a timer, not the first turn landing; a runner that reports its first turn lifts it.
const SPINNER_CEILING_MS = 20_000;
const CATCHING_UP_SPINNER_MS = 1_500;

export function useRefresh(): { refreshing: boolean; onRefresh: () => void } {
  const { runGather, gather } = useAppState();
  const [refreshing, setRefreshing] = useState(false);
  const walkDone = gather.initialWalkDone;
  const onRefresh = useCallback(() => {
    setRefreshing(true);
    const ceiling = new Promise<void>((resolve) => setTimeout(resolve, walkDone ? SPINNER_CEILING_MS : CATCHING_UP_SPINNER_MS));
    void Promise.race([runGather('refresh').catch(() => undefined), ceiling]).finally(() => setRefreshing(false));
  }, [runGather, walkDone]);
  return { refreshing, onRefresh };
}

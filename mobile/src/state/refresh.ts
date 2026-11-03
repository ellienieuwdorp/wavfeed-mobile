/**
 * Pull to refresh on a collection tab: a refresh turn, with the native spinner held until the
 * feed step lands (the turn moves `lastSuccessAt`, so "Updated just now" and the spinner change in one render), the
 * turn returns, or a ceiling passes. The lists when due, release pages and the sweep after the feed run on without it. A refresh during the first walk joins a chain of turns that can run for minutes, and the
 * catch-up line already says so, so the spinner lets go after a beat there. The spinner reads as stopped while its tab
 * is out of view and as refreshing again on return: iOS stills a UIRefreshControl that leaves the window, and React
 * Native's only restart is `refreshing` turning true on a control that has ended. Each pull ends in one
 * `feed_refreshed` naming its tab and whether the ceiling let the spinner go before the feed step landed.
 */
import { useIsFocused } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';

import { useSharing } from '@/tally/Sharing';

import { useAppState } from './appState';

// ceiling: the ceiling is a timer for a feed step that never lands; a runner that reports its steps could replace it.
const SPINNER_CEILING_MS = 20_000;
const CATCHING_UP_SPINNER_MS = 1_500;

export function useRefresh(tab: 'feed' | 'releases'): { refreshing: boolean; onRefresh: () => void } {
  const { runGather, gather } = useAppState();
  const { track } = useSharing();
  const [pull, setPull] = useState<{ readonly from: number | null } | null>(null);
  const walkDone = gather.initialWalkDone;
  const lastSuccessAt = gather.lastSuccessAt;
  const landed = useRef(lastSuccessAt);
  useEffect(() => {
    landed.current = lastSuccessAt;
  }, [lastSuccessAt]);
  const onRefresh = useCallback(() => {
    const mine = { from: lastSuccessAt };
    setPull(mine);
    const ceiling = new Promise<'ceiling'>((resolve) => setTimeout(() => resolve('ceiling'), walkDone ? SPINNER_CEILING_MS : CATCHING_UP_SPINNER_MS));
    const turn = runGather('refresh').then(
      () => 'turn' as const,
      () => 'turn' as const,
    );
    // Only this pull's own end clears it, so an earlier pull's ceiling cannot cut a later one short.
    void Promise.race([turn, ceiling]).then((first) => {
      setPull((held) => (held === mine ? null : held));
      const hitCeiling = first === 'ceiling' && landed.current === mine.from;
      track({ name: 'feed_refreshed', props: { from: tab, hit_ceiling: hitCeiling } });
    });
  }, [runGather, walkDone, lastSuccessAt, track, tab]);
  const inView = useInView();
  return { refreshing: inView && pull !== null && lastSuccessAt === pull.from, onRefresh };
}

/** Focus, but a frame late on the way in: focus lands before the screen is back in the window, where begin is lost. */
function useInView(): boolean {
  const focused = useIsFocused();
  const [settled, setSettled] = useState(focused);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setSettled(focused));
    return () => cancelAnimationFrame(frame);
  }, [focused]);
  return focused && settled;
}

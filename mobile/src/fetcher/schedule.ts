/**
 * When a gather turn runs in the foreground (task 0036, decision 4): as the app becomes active if the last turn is
 * fifteen minutes old, and every fifteen minutes while it stays active. Pull to refresh calls the turn directly.
 */
import { useEffect, useRef } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

export const GATHER_INTERVAL_MS = 15 * 60 * 1000;

export type ScheduledReason = 'open' | 'timer';

export function shouldRun(lastTurnAt: number | null, now: number): boolean {
  return lastTurnAt === null || now - lastTurnAt >= GATHER_INTERVAL_MS;
}

/** `readLastTurnAt` reads the stored `GatherState.lastTurnAt`, so a turn started elsewhere counts. */
export function useGatherSchedule(
  run: (reason: ScheduledReason) => unknown,
  readLastTurnAt?: () => Promise<number | null>,
): void {
  const runRef = useRef(run);
  const readRef = useRef(readLastTurnAt);
  const startedAt = useRef<number | null>(null);

  useEffect(() => {
    runRef.current = run;
    readRef.current = readLastTurnAt;
  }, [run, readLastTurnAt]);

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    let live = true;

    const maybeRun = async (reason: ScheduledReason): Promise<void> => {
      const stored = (await readRef.current?.().catch(() => null)) ?? null;
      const known = [stored, startedAt.current].filter((at): at is number => at !== null);
      if (!live || !shouldRun(known.length === 0 ? null : Math.max(...known), Date.now())) return;
      startedAt.current = Date.now();
      await Promise.resolve(runRef.current(reason)).catch(() => undefined);
    };
    const wake = (): void => {
      void maybeRun('open');
      timer ??= setInterval(() => void maybeRun('timer'), GATHER_INTERVAL_MS);
    };
    const sleep = (): void => {
      if (timer !== null) clearInterval(timer);
      timer = null;
    };
    const onChange = (next: AppStateStatus): void => (next === 'active' ? wake() : sleep());

    if (AppState.currentState !== 'background' && AppState.currentState !== 'inactive') wake();
    const subscription = AppState.addEventListener('change', onChange);
    return () => {
      live = false;
      sleep();
      subscription.remove();
    };
  }, []);
}

/**
 * When a gather turn runs in the foreground: on mount, on every return to active and every
 * fifteen minutes while active, the stored state is asked whether a turn is due. A pending first walk always is, cursor
 * or not, so it resumes on every open and after a turn that failed before writing one; a caught-up feed waits fifteen
 * minutes. iOS freezes JS in the background without
 * restarting it, so nothing here remembers when it last ran: the store answers. Pull to refresh calls the turn directly.
 */
import { useEffect, useRef } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import { GATHER_INTERVAL_MS, type Due } from './cadence';

export type ScheduledReason = 'open' | 'timer';

export function useGatherSchedule(
  run: (reason: ScheduledReason) => unknown,
  readDue: (now: number) => Promise<Due>,
): void {
  const runRef = useRef(run);
  const readRef = useRef(readDue);

  useEffect(() => {
    runRef.current = run;
    readRef.current = readDue;
  }, [run, readDue]);

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    let live = true;

    const maybeRun = async (reason: ScheduledReason): Promise<void> => {
      const due = await readRef.current(Date.now()).catch((): Due => 'no');
      if (!live || due === 'no') return;
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

/**
 * The gather cadence shared by the foreground schedule and incomplete list attempts (task 0036, decision 4; task
 * 0070, decision 4): pending feed walks resume on every wake, and other automatic work waits fifteen minutes.
 */
export const GATHER_INTERVAL_MS = 15 * 60 * 1000;

/** `walk`: a walk is pending; `due`: the last turn is fifteen minutes old or none ran; `no`: neither. */
export type Due = 'walk' | 'due' | 'no';

export function dueFrom(walkPending: boolean, lastTurnAt: number | null, now: number): Due {
  if (walkPending) return 'walk';
  return lastTurnAt === null || now - lastTurnAt >= GATHER_INTERVAL_MS ? 'due' : 'no';
}

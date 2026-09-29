/**
 * How far back the first walk has reached, read from the stored walk alone (task 0040). Once a page has landed the
 * walk's cursor is the oldest Story date it holds; the depth probe's floor is where the walk should end, so the share of
 * the span from the walk's start down to the floor is the fill. It stops short of full, since the floor is the probe's
 * estimate and only the walk's end says it is done.
 */
import type { WalkState } from '@/fetcher/sink';

const FILL_CAP = 0.99;

export type WalkProgress = {
  /** Unix seconds: the oldest Story date the walk has reached. */
  readonly reachedAt: number | null;
  /** 0 to FILL_CAP; null while the walk has no floor to fill towards. */
  readonly fraction: number | null;
};

export function walkProgress(walk: WalkState | null): WalkProgress {
  if (walk === null || walk.kind !== 'feed_walk' || walk.pagesDone === 0) return { reachedAt: null, fraction: null };
  const startSec = Math.floor(walk.startedAt / 1000);
  if (walk.floor === null || walk.floor >= startSec) return { reachedAt: walk.olderThan, fraction: null };
  const share = (startSec - walk.olderThan) / (startSec - walk.floor);
  return { reachedAt: walk.olderThan, fraction: Math.min(Math.max(share, 0), FILL_CAP) };
}

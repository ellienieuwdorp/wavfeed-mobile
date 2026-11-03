/**
 * How far the first walk has come, read from the stored walk and the count so far. Once
 * a page has landed the walk's cursor is the oldest Story date it holds. The fill is a share of Stories: the Stories
 * still to come are the rate of Stories integrated from the cursor down to the depth probe's floor, the rate at any
 * moment interpolated on a logarithmic scale between the probe's answers and the walk's own last pages at the cursor,
 * and held flat past the outermost of them. A walk ends at its page cap whatever lies below, so the estimate never
 * exceeds the pages left at the walk's own Stories per page. The fill stops short of full, since only the walk's end
 * says it is done, and `forwardOnly` keeps it from moving back while the app runs.
 */
import type { StorySample, WalkState } from '@/fetcher/sink';

const FILL_CAP = 0.99;

export type WalkProgress = {
  /** Unix seconds: the oldest Story date the walk has reached. */
  readonly reachedAt: number | null;
  /** 0 to FILL_CAP; null while there is no floor, no sample to estimate from or no count, which draws the sweep. */
  readonly fraction: number | null;
};

/** A rate of Stories per second at a moment, unix seconds. */
type Knot = { readonly at: number; readonly rate: number };

/** The samples as one span; none when it has no length, since a rate needs one. */
function knotOf(samples: readonly StorySample[], at?: number): Knot | null {
  if (samples.length === 0) return null;
  const newest = Math.max(...samples.map((s) => s.newest));
  const oldest = Math.min(...samples.map((s) => s.oldest));
  const count = samples.reduce((sum, s) => sum + s.count, 0);
  const span = newest - oldest;
  return span > 0 && count > 0 ? { at: at ?? (newest + oldest) / 2, rate: count / span } : null;
}

/** `knots` sorted by time, at least one. */
function rateAt(knots: readonly Knot[], t: number): number {
  const first = knots[0] as Knot;
  const last = knots[knots.length - 1] as Knot;
  if (t <= first.at) return first.rate;
  if (t >= last.at) return last.rate;
  for (let i = 0; i + 1 < knots.length; i += 1) {
    const a = knots[i] as Knot;
    const b = knots[i + 1] as Knot;
    if (t > b.at) continue;
    const share = b.at === a.at ? 0 : (t - a.at) / (b.at - a.at);
    return Math.exp(Math.log(a.rate) + share * (Math.log(b.rate) - Math.log(a.rate)));
  }
  return last.rate;
}

/** The logarithmic mean: the average of a rate that moves exponentially from `a` to `b`. */
function logMean(a: number, b: number): number {
  return a === b ? a : (b - a) / Math.log(b / a);
}

/** Stories between `from` and `to`: exact per piece, since the log rate is linear between knots and flat past them. */
function storiesBetween(knots: readonly Knot[], from: number, to: number): number {
  const edges = [from, ...knots.map((k) => k.at).filter((at) => at > from && at < to), to];
  let sum = 0;
  for (let i = 0; i + 1 < edges.length; i += 1) {
    const a = edges[i] as number;
    const b = edges[i + 1] as number;
    sum += (b - a) * logMean(rateAt(knots, a), rateAt(knots, b));
  }
  return sum;
}

export function walkProgress(walk: WalkState | null, storiesSoFar: number): WalkProgress {
  if (walk === null || walk.kind !== 'feed_walk' || walk.pagesDone === 0) return { reachedAt: null, fraction: null };
  const reachedAt = walk.olderThan;
  const floor = walk.floor;
  if (floor === null || floor >= Math.floor(walk.startedAt / 1000)) return { reachedAt, fraction: null };

  const cursor = knotOf(walk.recent ?? [], walk.olderThan);
  const probed = (walk.samples ?? []).flatMap((s) => knotOf([s]) ?? []);
  const knots = [...(cursor === null ? probed : probed.filter((k) => k.at < cursor.at)), ...(cursor === null ? [] : [cursor])]
    .sort((a, b) => a.at - b.at);
  if (knots.length === 0) return { reachedAt, fraction: null };

  // Nothing left: the cursor is at or past the floor, or the walk is at its page cap.
  const estimate = floor < walk.olderThan ? storiesBetween(knots, floor, walk.olderThan) : 0;
  const pagesLeft = Math.max(walk.maxPages - walk.pagesDone, 0);
  if (estimate <= 0 || pagesLeft === 0) return { reachedAt, fraction: FILL_CAP };
  // No count yet, as when a turn dies between landing a page and counting it: a share of nothing sweeps.
  if (storiesSoFar <= 0) return { reachedAt, fraction: null };
  const toCome = Math.min(estimate, (pagesLeft * storiesSoFar) / walk.pagesDone);
  return { reachedAt, fraction: Math.min(storiesSoFar / (storiesSoFar + toCome), FILL_CAP) };
}

let held: { readonly startedAt: number; readonly fraction: number } | null = null;

/** The fill for the walk started at `startedAt`, never below the last one while the app runs. */
export function forwardOnly(startedAt: number, fraction: number): number {
  const at = held !== null && held.startedAt === startedAt ? Math.max(held.fraction, fraction) : fraction;
  held = { startedAt, fraction: at };
  return at;
}

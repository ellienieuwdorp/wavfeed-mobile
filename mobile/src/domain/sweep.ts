/**
 * The band details sweep's tiers: a Page's own discography dates decide how often it is read again (ADR-0017); no jitter, since one phone enqueues no herd.
 * Ported from server/apps/poller/src/sweep.ts and config.ts (task 0036).
 */
import { DAY_MS, HOUR_MS } from '../lib/time';
import { asRecord, parseWireDate } from './wire';

export type SweepTier = 'hot' | 'warm' | 'cold';

export const SWEEP_TIER_HOT_WINDOW_MS = 90 * DAY_MS;
export const SWEEP_TIER_WARM_WINDOW_MS = 365 * DAY_MS;
export const SWEEP_TIER_HOT_INTERVAL_MS = HOUR_MS;
export const SWEEP_TIER_WARM_INTERVAL_MS = 6 * HOUR_MS;
export const SWEEP_TIER_COLD_INTERVAL_MS = DAY_MS;

export function intervalFor(tier: SweepTier): number {
  if (tier === 'hot') return SWEEP_TIER_HOT_INTERVAL_MS;
  return tier === 'warm' ? SWEEP_TIER_WARM_INTERVAL_MS : SWEEP_TIER_COLD_INTERVAL_MS;
}

/** A date still ahead is hot; no dates at all is cold. */
export function tierFor(releaseDates: readonly Date[], now: Date): SweepTier {
  let newest: number | null = null;
  for (const date of releaseDates) {
    const time = date.getTime();
    if (time >= now.getTime()) return 'hot';
    if (newest === null || time > newest) newest = time;
  }
  if (newest === null) return 'cold';
  const age = now.getTime() - newest;
  if (age <= SWEEP_TIER_HOT_WINDOW_MS) return 'hot';
  return age <= SWEEP_TIER_WARM_WINDOW_MS ? 'warm' : 'cold';
}

function readWireDate(value: unknown): Date | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return new Date(value * 1000);
  if (typeof value !== 'string' || value.trim() === '') return undefined;
  return parseWireDate(value);
}

/** Every release date a `band_details` body names, read forgivingly: a bad field costs a tier, never a document. */
export function readDiscographyDates(bandDetails: unknown): Date[] {
  const items = asRecord(bandDetails)?.discography;
  if (!Array.isArray(items)) return [];
  const dates: Date[] = [];
  for (const entry of items) {
    const date = readWireDate(asRecord(entry)?.release_date);
    if (date !== undefined) dates.push(date);
  }
  return dates;
}

/**
 * The band details sweep's rules (ADR-0017): tiers by how recently a Page released, a jittered next visit, a per-Page
 * backoff after failures and the endpoint's breaker. Ported from server/apps/poller/src/sweep.ts,
 * circuitBreaker.ts and config.ts (task 0036, decision 4).
 */
import { parseWireDate } from '../domain/wire';
import { asRecord } from '../domain/wire';
import type { SweepTier } from './sink';

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

export const SWEEP_TURN_MAX = 12;

const HOT_WINDOW_MS = 90 * DAY_MS;
const WARM_WINDOW_MS = 365 * DAY_MS;
const TIER_INTERVAL_MS: Readonly<Record<SweepTier, number>> = { hot: HOUR_MS, warm: 6 * HOUR_MS, cold: DAY_MS };
const TIER_JITTER = 0.1;

const BREAKER_FAILURE_THRESHOLD = 3;
const BREAKER_COOLDOWN_MS = 5 * MINUTE_MS;
const BREAKER_MAX_COOLDOWN_MS = HOUR_MS;
const BREAKER_RECOVERY_SUCCESSES = 5;
const REFUSAL_STATUSES: readonly number[] = [403, 429];

/** Hot for a release inside 90 days or still ahead, warm inside a year, cold otherwise or unread. */
export function tierFor(releaseDatesMs: readonly number[], nowMs: number): SweepTier {
  let newest: number | null = null;
  for (const time of releaseDatesMs) {
    if (time >= nowMs) return 'hot';
    if (newest === null || time > newest) newest = time;
  }
  if (newest === null) return 'cold';
  const age = nowMs - newest;
  if (age <= HOT_WINDOW_MS) return 'hot';
  return age <= WARM_WINDOW_MS ? 'warm' : 'cold';
}

/** Unix seconds on the mobile endpoints, a date string elsewhere; either is read, neither required. */
function readDateMs(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value * 1000;
  if (typeof value !== 'string' || value.trim() === '') return undefined;
  return parseWireDate(value)?.getTime();
}

/** Only `discography[].release_date`: the Projection does the real parse. */
export function readDiscographyDates(bandDetails: unknown): number[] {
  const items = asRecord(bandDetails)?.discography;
  if (!Array.isArray(items)) return [];
  const dates: number[] = [];
  for (const entry of items) {
    const date = readDateMs(asRecord(entry)?.release_date);
    if (date !== undefined) dates.push(date);
  }
  return dates;
}

/** Jittered ten percent so Pages followed together do not stay due together. */
export function nextDueFor(tier: SweepTier, nowMs: number, random: () => number): number {
  const interval = TIER_INTERVAL_MS[tier];
  return nowMs + Math.round(interval + interval * TIER_JITTER * (random() * 2 - 1));
}

export function failureBackoffMs(failures: number): number {
  return Math.min(HOUR_MS * 2 ** Math.max(0, failures - 1), DAY_MS);
}

/**
 * Opens on a 403 or 429 or three failures running; the cooldown doubles per reopening, an hour at most. In memory,
 * as on the server: the process told to stop is the one that stops (ADR-0014).
 */
export class SweepBreaker {
  private openUntil: number | null = null;
  private failures = 0;
  private opens = 0;
  private successesSinceOpen = 0;

  isOpen(nowMs: number): boolean {
    if (this.openUntil !== null && this.openUntil <= nowMs) {
      this.openUntil = null;
      this.failures = 0;
    }
    return this.openUntil !== null;
  }

  recordSuccess(): void {
    this.failures = 0;
    if (this.opens === 0) return;
    this.successesSinceOpen += 1;
    if (this.successesSinceOpen >= BREAKER_RECOVERY_SUCCESSES) {
      this.opens = 0;
      this.successesSinceOpen = 0;
    }
  }

  recordFailure(nowMs: number, status: number): boolean {
    this.failures += 1;
    if (!REFUSAL_STATUSES.includes(status) && this.failures < BREAKER_FAILURE_THRESHOLD) return false;
    this.opens += 1;
    this.successesSinceOpen = 0;
    this.openUntil = nowMs + Math.min(BREAKER_COOLDOWN_MS * 2 ** (this.opens - 1), BREAKER_MAX_COOLDOWN_MS);
    return true;
  }
}

export const bandDetailsBreaker = new SweepBreaker();

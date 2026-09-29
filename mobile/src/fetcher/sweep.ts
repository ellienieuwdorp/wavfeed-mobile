/**
 * The band details sweep's per-turn quota and the endpoint's breaker (ADR-0017); the store books each Page's tier and
 * next visit (store/queries.ts `markSwept`). Ported from server/apps/poller/src/circuitBreaker.ts and config.ts
 * (task 0036, decision 4).
 */
import { REFUSAL_STATUSES } from '../bandcamp/wire';

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

export const SWEEP_TURN_MAX = 12;

const BREAKER_FAILURE_THRESHOLD = 3;
const BREAKER_COOLDOWN_MS = 5 * MINUTE_MS;
const BREAKER_MAX_COOLDOWN_MS = HOUR_MS;
const BREAKER_RECOVERY_SUCCESSES = 5;

/**
 * Opens on a 403 or 429 or three failures running; the cooldown doubles per reopening, an hour at most. In memory,
 * as on the server: the process told to stop is the one that stops (ADR-0014).
 */
export class SweepBreaker {
  private openUntil: number | null = null;
  private failures = 0;
  private opens = 0;
  private successesSinceOpen = 0;
  private openedEver = 0;

  /** Every opening since the process started, which a recovery never resets: a gather chain compares it before and after (task 0038). */
  get openings(): number {
    return this.openedEver;
  }

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
    this.openedEver += 1;
    this.successesSinceOpen = 0;
    this.openUntil = nowMs + Math.min(BREAKER_COOLDOWN_MS * 2 ** (this.opens - 1), BREAKER_MAX_COOLDOWN_MS);
    return true;
  }
}

export const bandDetailsBreaker = new SweepBreaker();

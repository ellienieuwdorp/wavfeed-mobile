/** The time units the app computes in, in one home (V2-PLAN section 7, review ARCH-9): milliseconds, unless `_S`. */
export const SECOND_MS = 1_000;
export const MINUTE_MS = 60 * SECOND_MS;
export const HOUR_MS = 60 * MINUTE_MS;
export const DAY_MS = 24 * HOUR_MS;
/** A day in Unix seconds, the unit of Bandcamp's feed cursors. */
export const DAY_S = DAY_MS / SECOND_MS;

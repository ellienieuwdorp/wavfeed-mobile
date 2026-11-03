/**
 * What the app says to a screen reader without moving its focus (the phone app review, VIS-2): the first walk's two
 * milestones, its end and a sign-out pausing it, and never a count tick; and how long a raised notice line stays, eight
 * seconds, four for a swipe's confirmation, and until it is dismissed while a screen reader is on (DESIGN-UI section 12).
 */
import { copy } from '@/copy';
import type { GatherState } from '@/fetcher/sink';

export const NOTICE_LIFETIME_MS = 8000;
/** A confirmation of the Fan's own swipe, Material's short snackbar. */
export const CONFIRMATION_LIFETIME_MS = 4000;

/** Null keeps the line until it is dismissed: a line heard late in its seconds would leave before its action is reached. */
export function noticeLifetime(screenReader: boolean, confirmation = false): number | null {
  if (screenReader) return null;
  return confirmation ? CONFIRMATION_LIFETIME_MS : NOTICE_LIFETIME_MS;
}

function walking(state: GatherState): boolean {
  return state.identity !== null && !state.initialWalkDone && state.pausedReason === null;
}

/**
 * The line for the step from `before` to `after`, when the first walk ends or pauses there. Only a walk that was running
 * says anything, so the state first read from the store, with no Fan before it, stays quiet.
 */
export function catchUpMilestone(before: GatherState, after: GatherState): string | null {
  if (!walking(before) || after.identity === null) return null;
  if (after.initialWalkDone) return copy.catchUp.finished;
  if (after.pausedReason !== null) return copy.catchUp.paused;
  return null;
}

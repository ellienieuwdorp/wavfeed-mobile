/**
 * The row swipe's rules (task 0071, decision 15), kept apart from the gesture in `WishlistSwipe` so they run under
 * `node --test`: the press a swipe makes on what the heart shows, where a drag puts the row and whether lifting there
 * commits, and the press its Android snackbar's Undo makes.
 */
import type { WishlistWriteKind } from '@/bandcamp/wishlist';

import type { Membership } from './state';

/** Add on an item off the wishlist, remove on one on it, nothing while membership is unknown, as the heart takes no press then. */
export function swipeVerb(membership: Membership): WishlistWriteKind | null {
  if (!membership.known) return null;
  return membership.on ? 'remove' : 'add';
}

/**
 * The row's offset for a drag of `x` across a row `width` wide: rightward only, so a swipe left moves nothing, and never
 * past the row. It is armed, and lifting commits, once past half the width. Runs on the UI thread.
 */
export function swipeAt(x: number, width: number): { dx: number; armed: boolean } {
  'worklet';
  const dx = Math.min(Math.max(x, 0), width);
  return { dx, armed: dx > width / 2 };
}

/** The press that takes a committed swipe back. */
export function undoOf(action: WishlistWriteKind): WishlistWriteKind {
  return action === 'add' ? 'remove' : 'add';
}

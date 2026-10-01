/**
 * The row menu's items as a screen reader's actions (the phone app review, VIS-9 and FLOW-13): VoiceOver's actions rotor
 * and TalkBack's actions menu list every item that would take a press, under its menu label, except play, which is the
 * control's own activation, and Bought by where the row names who bought it. RowMenu.tsx builds the items and hands
 * these to the row and its art. The iOS row is one element, so the heart's state it hides is said in its label.
 */
import type { WishlistWriteKind } from '@/bandcamp/wishlist';
import { copy } from '@/copy';
import type { Membership } from '@/wishlist/state';

export type RowAction = { readonly key: string; readonly label: string; readonly enabled: boolean; readonly run: () => void };

export type SpokenActions = {
  readonly accessibilityActions: { name: string; label: string }[];
  readonly onAccessibilityAction: (event: { readonly nativeEvent: { readonly actionName: string } }) => void;
};

export const PLAY_ACTION = 'play';

/** `openFans` is Bought by's press, offered only when `fans` names someone. */
export function spokenActions<Fan>(actions: readonly RowAction[], fans: readonly Fan[], openFans: (fans: readonly Fan[]) => void): SpokenActions {
  const boughtBy: RowAction[] = fans.length === 0 ? [] : [{ key: 'bought_by', label: copy.boughtBy.title, enabled: true, run: () => openFans(fans) }];
  const offered = [...actions, ...boughtBy].filter((a) => a.enabled && a.key !== PLAY_ACTION);
  return {
    accessibilityActions: offered.map((a) => ({ name: a.key, label: a.label })),
    onAccessibilityAction: (event) => offered.find((a) => a.key === event.nativeEvent.actionName)?.run(),
  };
}

/** The heart's state as the iOS row's label says it after the facts; off and not asked yet say nothing. */
export function heardWishlist(membership: Membership, pending: WishlistWriteKind | null): string | null {
  if (pending !== null) return pending === 'add' ? copy.heart.adding : copy.heart.removing;
  return membership.known && membership.wishlisted ? copy.heart.on : null;
}

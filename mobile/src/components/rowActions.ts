/**
 * The row menu's items as a screen reader's actions (the phone app review, VIS-9 and FLOW-13): VoiceOver's actions rotor
 * and TalkBack's actions menu list every item that would take a press, under its menu label, except play, which is the
 * control's own activation, and Bought by where the row names who bought it. RowMenu.tsx builds the items and hands
 * these to the row and its art. The iOS row is one element and the Android row's body another, so their label says the
 * whole row (heardRow), and an Upcoming card says the same (heardParts): the faces as who bought it and the wishlist
 * state rows and cards no longer draw (task 0071, decisions 12, 13, 14 and 16).
 */
import { boughtByPhrase, copy, spokenFacts } from '@/copy';
import type { ApiFanRef } from '@/domain/apiTypes';
import type { CreditLine } from '@/domain/credit';
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
export function heardWishlist(membership: Membership): string | null {
  return membership.known && membership.on ? copy.heart.on : null;
}

/** What a row draws, as its label reads it: the credit line's two names, the day, the count and the faces. */
export type HeardRow = {
  readonly title: string;
  readonly credit: CreditLine;
  /** The eyebrow's words, "Wed 7" or "out Tue 13 Oct"; null when the row has no day. */
  readonly day: string | null;
  /** "1 of 4 tracks" from tracksOutPhrase, where the row's art draws the badge. */
  readonly count: string | null;
  readonly buyers: readonly ApiFanRef[];
};

/** A Release as a row or an Upcoming card says it: "Title by Artist", then "Page, Wed 7, 1 of 4 tracks, bought by ana". */
export function heardParts(row: HeardRow, membership: Membership): { readonly named: string; readonly facts: string } {
  return {
    named: copy.titleBy(row.title, row.credit.artist),
    facts: spokenFacts([row.credit.extra, row.day, row.count, boughtByPhrase(row.buyers), heardWishlist(membership)]),
  };
}

/** "Play Title by Artist, Page, Wed 7, 1 of 4 tracks, bought by ana and 1 other, on your Bandcamp wishlist". */
export function heardRow(row: HeardRow, membership: Membership, pause: boolean): string {
  const { named, facts } = heardParts(row, membership);
  return pause ? copy.pause(named, facts) : copy.play(named, facts);
}

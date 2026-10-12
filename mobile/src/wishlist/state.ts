/**
 * The heart's truth and its press (DESIGN-UI section 12, ADR-0016, task 0036). Membership is `wishlist_items` as the
 * Projection last folded it, read once per store version into one set every heart shares (`membership.ts`). A press is
 * one Wishlist Action run on the device: the crumb read off the Release's page, or off the newest Story's Release on bandcamp.com
 * when it sits on a custom domain, and the write through the session (ADR-0016 amendment 2026-09-28), every response
 * through `putRaw` before the outcome is acted on (ADR-0004), then the item written into or out of `wishlist_items`
 * here, because the Projection folds only the wishlist walk and never a collect answer. A rebuild therefore forgets a press until the next walk brings it back.
 * A press flips the heart before Bandcamp answers (ADR-0016 amendment 2026-10-02): its intent belongs to the item,
 * never the control, so every heart for the item flips together and the bar's heart does not carry a press across a
 * track change, and `press.ts` coalesces taps on an item while its exchange travels, last tap wins.
 * Membership is not asked yet until a wishlist walk has been asked once (`GatherState.wishlistAskedAt`), whatever it
 * answered, so a wishlist that keeps erroring still leaves every heart pressable, as off. Each press logs one line of
 * codes, counts, where the crumb came from, the answer's field names and flags and Bandcamp's reason scrubbed by
 * `toDetail`, never a header, a crumb or a field named like a secret (task 0036, decision 1); a refusal's notice carries
 * that reason when Bandcamp gave one.
 */
import { openURL } from 'expo-linking';
import { router } from 'expo-router';
import { useCallback, useEffect, useSyncExternalStore } from 'react';

import type { WishlistWriteKind } from '@/bandcamp/wishlist';
import { useNotice, type NoticeLine } from '@/components/noticeState';
import { copy } from '@/copy';
import type { ItemType } from '@/domain/types';
import { devLog } from '@/lib/devLog';
import { webUrl } from '@/lib/format';
import { failedHaptic, turnedOnHaptic } from '@/lib/haptics';
import { useAppState } from '@/state/appState';
import { standingOf } from '@/state/standing';
import { connectHref, wishlistActionFinished, type PressSurface } from '@/tally/actions';
import { useSharing } from '@/tally/Sharing';

import { wishlistCopy } from './copy';
import { exchange, type PressFailure, type Sent, type WishlistTarget } from './exchange';
import { keyOf, loadMembership, shownOf, subscribe, wishlistLifetime } from './membership';
import { pressItem, type Tell } from './press';

export type { WishlistTarget } from './exchange';

/** What a heart draws: `on` is the Fan's last press while its exchange travels, else what Bandcamp confirmed. */
export type Membership = { readonly known: false } | { readonly known: true; readonly on: boolean };

/**
 * What the item's hearts draw, a travelling press's intent over the confirmed answer. Each heart selects its own key's
 * answer, so only the hearts a load or a press moves re-render (finding TECH-M1).
 */
export function useMembership(itemType: ItemType, itemId: string): Membership {
  const { db, version, gather } = useAppState();
  const key = keyOf(itemType, itemId);
  const listen = useCallback((listener: () => void) => subscribe(db, listener), [db]);
  const answer = useSyncExternalStore(listen, () => shownOf(db, key));
  useEffect(() => loadMembership(db, version), [db, version]);
  const asked = gather.wishlistFetchedAt !== null || gather.wishlistAskedAt !== null;
  if (!asked || answer === 'unknown') return { known: false };
  return { known: true, on: answer === 'on' };
}

/**
 * One line per press for the Metro log: codes, counts, ids, the crumb's source word and page reads, the answer's shape
 * and the Release a Track press read its `band_id` off, never a crumb or a value named like a secret.
 */
function logPress(action: WishlistWriteKind, target: WishlistTarget, sent: Sent) {
  const key = keyOf(target.itemType, target.itemId);
  const release = keyOf(target.release.itemType, target.release.itemId);
  const facts = [
    `wishlist ${action} ${key}`,
    ...(release === key ? [] : [`on=${release}`]),
    sent.failure ?? 'ok',
    sent.wire === null ? 'no write sent' : `end=${sent.wire.end} status=${sent.wire.status ?? 'none'}`,
    ...(sent.wire === null ? [] : [`requests=${sent.wire.requests} answer=${sent.wire.answer ?? 'none'}`]),
    ...(sent.wire === null ? [] : [`crumb=${sent.wire.crumb} pages=${sent.wire.pages}`]),
    ...(sent.wire === null || sent.wire.pages === 0 ? [] : [`page=${sent.wire.pageStatus ?? 'none'}`]),
    ...(sent.wire?.redirected === true ? ['redirected'] : []),
    ...(sent.wire?.said == null ? [] : [`shape="${sent.wire.said}"`]),
    sent.band === null ? 'band=none' : `band=${sent.band.id} from=${sent.band.from}`,
  ].join(' ');
  if (sent.failure === null) devLog(facts);
  else console.warn(facts);
}

function noticeFor(failure: PressFailure | 'other', reason: string | null = null, url: string | null = null): NoticeLine {
  const signIn = { onPress: () => router.push(connectHref('wishlist_notice')) };
  // A refusal leaves the Fan the Release's own page to wishlist it by hand (finding FLOW-17), under the row menu's
  // label for the same page.
  const page = url === null ? null : webUrl(url);
  const open = page === null ? {} : { action: { label: copy.rowMenu.open, onPress: () => void openURL(page).catch(() => undefined) } };
  switch (failure) {
    case 'logged_out':
      return { code: 'wishlist_failed', text: wishlistCopy.notice.loggedOut, action: { label: copy.notice.signInAgain, ...signIn } };
    case 'not_signed_in':
      return { code: 'wishlist_failed', text: wishlistCopy.notice.notSignedIn, action: { label: wishlistCopy.notice.signIn, ...signIn } };
    case 'bandcamp_unreachable':
      return { code: 'wishlist_failed', text: wishlistCopy.notice.unreachable };
    case 'bandcamp_rejected':
      return { code: 'wishlist_failed', text: reason === null ? wishlistCopy.notice.rejected : wishlistCopy.notice.rejectedSaying(reason), ...open };
    default:
      return { code: 'wishlist_failed', text: wishlistCopy.notice.other };
  }
}

/**
 * The press every heart and the row menu run. Where the phone stands is read off the app state, which holds it in
 * memory (`standing.ts`): with no Fan, the Demo's (task 0043, decision 7), a sign-out from Settings or a sign-in
 * Bandcamp no longer accepts, nothing is flipped and the press ends in its notice.
 * Otherwise the heart flips at once and the exchange travels behind it (`press.ts`, ADR-0016 amendment 2026-10-02),
 * with a light impact when the press turns the heart on, unless the caller says it `ticked` already (a swipe ticks as
 * it passes its commit point). Each exchange ends in one `wishlist_action_finished` naming the `surface` pressed
 * (task 0038) and one log line; a failure the Fan is told about raises its notice and the error haptic. Answers
 * whether the press was taken, so the heart pops only then.
 */
export function useWishlistPress(surface: PressSurface): (target: WishlistTarget, action: WishlistWriteKind, ticked?: boolean) => boolean {
  const app = useAppState();
  const { show } = useNotice();
  const { track } = useSharing();
  return useCallback(
    (target, action, ticked = false) => {
      const lifetime = wishlistLifetime(app.db);
      if (!lifetime.active()) return false;
      const key = keyOf(target.itemType, target.itemId);
      const onTrack = key !== keyOf(target.release.itemType, target.release.itemId);
      const standing = standingOf(app.gather.identity, app.gather.pausedReason);
      if (standing !== 'connected') {
        const failure = standing === 'signedOut' ? 'logged_out' : 'not_signed_in';
        track(wishlistActionFinished({ action, surface, onTrack, failure, wire: null }));
        logPress(action, target, { failure, reason: null, band: null, wire: null });
        show(noticeFor(failure));
        return false;
      }
      const send = async (on: boolean): Promise<Tell | null> => {
        const sending: WishlistWriteKind = on ? 'add' : 'remove';
        let told = false;
        try {
          const sent = await exchange(app, target, sending, lifetime);
          if (!lifetime.active() || sent === null) return null;
          told = true;
          track(wishlistActionFinished({ action: sending, surface, onTrack, failure: sent.failure, wire: sent.wire }));
          logPress(sending, target, sent);
          const { failure, reason, url } = sent;
          return failure === null ? null : () => tell(noticeFor(failure, reason, url));
        } catch (error: unknown) {
          if (!lifetime.active()) return null;
          console.warn(`wishlist ${sending} ${key} threw:`, error instanceof Error ? error.message : String(error));
          if (!told) track(wishlistActionFinished({ action: sending, surface, onTrack, failure: 'other', wire: null }));
          return () => tell(noticeFor('other'));
        }
      };
      const tell = (line: NoticeLine) => {
        show(line);
        failedHaptic();
      };
      const taken = pressItem(key, action === 'add', { db: app.db, send, saved: app.invalidate });
      if (taken && action === 'add' && !ticked) turnedOnHaptic();
      return taken;
    },
    [app, show, track, surface],
  );
}

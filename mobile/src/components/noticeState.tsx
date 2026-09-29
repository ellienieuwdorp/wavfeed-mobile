/**
 * The notice line's state (DESIGN-UI section 12): one line, an optional action, and a dismiss. A line raised with `show`
 * (a failed wishlist press) replaces the last and leaves by itself after eight seconds. Under it, derived from the
 * gather state, Bandcamp signing this phone out: "Sign in again" opens Connect, it stays until acted on, and its
 * dismiss lasts the session. Each line raised, and the signed-out line once per sign-out, is a `notice_shown` by its
 * code (task 0038).
 */
import { router } from 'expo-router';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { copy } from '@/copy';
import { useAppState } from '@/state/appState';
import { connectHref } from '@/tally/actions';
import type { TallyProps } from '@/tally/catalogue';
import { useSharing } from '@/tally/Sharing';

export type NoticeLine = { code: TallyProps<'notice_shown'>['code']; text: string; action?: { label: string; onPress: () => void } };

export type Notices = { notice: NoticeLine | null; show: (line: NoticeLine) => void; dismiss: () => void };

export const NOTICE_LIFETIME_MS = 8000;

const SIGNED_OUT: NoticeLine = {
  code: 'signed_out',
  text: copy.notice.signedOut,
  action: { label: copy.notice.signInAgain, onPress: () => router.push(connectHref('signed_out_notice')) },
};

const NoticeContext = createContext<Notices | null>(null);

export function NoticeProvider({ children }: { children: ReactNode }) {
  const { gather } = useAppState();
  const signedOut = gather.pausedReason === 'logged_out';
  const [line, setLine] = useState<NoticeLine | null>(null);
  const [signedOutDismissed, setSignedOutDismissed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { track } = useSharing();
  // A dismiss lasts until the phone is signed in again; set during render, so the reset lands before anything commits.
  if (!signedOut && signedOutDismissed) setSignedOutDismissed(false);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const show = useCallback(
    (next: NoticeLine) => {
      if (timer.current) clearTimeout(timer.current);
      setLine(next);
      timer.current = setTimeout(() => setLine(null), NOTICE_LIFETIME_MS);
      track({ name: 'notice_shown', props: { code: next.code } });
    },
    [track],
  );

  const notice = line ?? (signedOut && !signedOutDismissed ? SIGNED_OUT : null);
  // Once per sign-out, however often a raised line covers it.
  const signedOutShown = notice === SIGNED_OUT;
  const counted = useRef(false);
  useEffect(() => {
    if (!signedOut) counted.current = false;
    if (!signedOutShown || counted.current) return;
    counted.current = true;
    track({ name: 'notice_shown', props: { code: 'signed_out' } });
  }, [signedOut, signedOutShown, track]);
  const dismiss = useCallback(() => {
    if (line) setLine(null);
    else setSignedOutDismissed(true);
  }, [line]);

  const value = useMemo<Notices>(() => ({ notice, show, dismiss }), [notice, show, dismiss]);
  return <NoticeContext.Provider value={value}>{children}</NoticeContext.Provider>;
}

export function useNotice(): Notices {
  const notices = useContext(NoticeContext);
  if (!notices) throw new Error('useNotice needs a NoticeProvider above it');
  return notices;
}

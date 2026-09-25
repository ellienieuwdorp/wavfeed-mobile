/**
 * The notice line's state (DESIGN-UI section 12): one line, an optional action, and a dismiss. A line raised with `show`
 * (a failed wishlist press) replaces the last and leaves by itself after eight seconds. Under it, derived from the
 * gather state, Bandcamp signing this phone out: "Sign in again" opens Connect, it stays until acted on, and its
 * dismiss lasts the session.
 */
import { router } from 'expo-router';
import { createContext, createElement, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { copy } from '@/copy';
import { useAppState } from '@/state/appState';

export type NoticeLine = { text: string; action?: { label: string; onPress: () => void } };

export type Notices = { notice: NoticeLine | null; show: (line: NoticeLine) => void; dismiss: () => void };

export const NOTICE_LIFETIME_MS = 8000;

const SIGNED_OUT: NoticeLine = {
  text: copy.notice.signedOut,
  action: { label: copy.notice.signInAgain, onPress: () => router.push('/connect') },
};

const NoticeContext = createContext<Notices | null>(null);

export function NoticeProvider({ children }: { children: ReactNode }) {
  const { gather } = useAppState();
  const signedOut = gather.pausedReason === 'logged_out';
  const [line, setLine] = useState<NoticeLine | null>(null);
  const [signedOutDismissed, setSignedOutDismissed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!signedOut) setSignedOutDismissed(false);
  }, [signedOut]);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const show = useCallback((next: NoticeLine) => {
    if (timer.current) clearTimeout(timer.current);
    setLine(next);
    timer.current = setTimeout(() => setLine(null), NOTICE_LIFETIME_MS);
  }, []);

  const notice = line ?? (signedOut && !signedOutDismissed ? SIGNED_OUT : null);
  const dismiss = useCallback(() => {
    if (line) setLine(null);
    else setSignedOutDismissed(true);
  }, [line]);

  const value = useMemo<Notices>(() => ({ notice, show, dismiss }), [notice, show, dismiss]);
  return createElement(NoticeContext.Provider, { value }, children);
}

export function useNotice(): Notices {
  const notices = useContext(NoticeContext);
  if (!notices) throw new Error('useNotice needs a NoticeProvider above it');
  return notices;
}

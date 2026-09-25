/**
 * The notice line's state (DESIGN-UI section 12): text, an optional action, and a
 * session-long dismiss. The stub starts on the canvas's sign-out notice so it can
 * be checked on a phone; the session lane raises it from the probe instead.
 */
import { router } from 'expo-router';
import { createContext, createElement, useContext, useState, type ReactNode } from 'react';

import { copy } from '@/copy';

export type NoticeLine = { text: string; action?: { label: string; onPress: () => void } };

export type Notices = { notice: NoticeLine | null; show: (line: NoticeLine) => void; dismiss: () => void };

const SIGNED_OUT: NoticeLine = {
  text: copy.notice.signedOut,
  action: { label: copy.notice.signInAgain, onPress: () => router.push('/connect') },
};

const NoticeContext = createContext<Notices | null>(null);

export function NoticeProvider({ children }: { children: ReactNode }) {
  const [notice, setNotice] = useState<NoticeLine | null>(SIGNED_OUT);
  const value: Notices = { notice, show: setNotice, dismiss: () => setNotice(null) };
  return createElement(NoticeContext.Provider, { value }, children);
}

export function useNotice(): Notices {
  const notices = useContext(NoticeContext);
  if (!notices) throw new Error('useNotice needs a NoticeProvider above it');
  return notices;
}

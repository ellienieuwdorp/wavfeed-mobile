/**
 * The notice line's state (DESIGN-UI section 12): one line, an optional action, and a dismiss. A line raised with `show`
 * (a failed wishlist press) replaces the last and leaves by itself after eight seconds, or stays until dismissed while a
 * screen reader is on. Under it, derived from the gather state, Bandcamp signing this phone out: "Sign in again" opens
 * Connect, it stays until acted on, and its dismiss lasts the session. Each line raised, and the signed-out line once per
 * sign-out, is a `notice_shown` by its code (task 0038). The provider is also where the app speaks without moving a
 * screen reader's focus (VIS-2): each line as it appears, which Android's live region already reads (Notice.tsx), the
 * first walk ending or pausing (state/spoken.ts), and the player's note when nothing can play.
 */
import { router } from 'expo-router';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Platform } from 'react-native';

import { copy } from '@/copy';
import { announce, useScreenReader } from '@/lib/a11y';
import { playerNote } from '@/player/transport';
import { useAppState } from '@/state/appState';
import { catchUpMilestone, noticeLifetime } from '@/state/spoken';
import { connectHref } from '@/tally/actions';
import type { TallyProps } from '@/tally/catalogue';
import { useSharing } from '@/tally/Sharing';

import { usePlayer } from './player/playerState';

/**
 * A null `code` is a confirmation of the Fan's own swipe (Android's snackbar, task 0071 decision 15): its press already
 * makes its Tally, so the line makes none, it leaves after four seconds and its action dismisses it.
 */
export type NoticeLine = { code: TallyProps<'notice_shown'>['code'] | null; text: string; action?: { label: string; onPress: () => void } };

export type Notices = { notice: NoticeLine | null; show: (line: NoticeLine) => void; dismiss: () => void };

const SIGNED_OUT: NoticeLine = {
  code: 'signed_out',
  text: copy.notice.signedOut,
  action: { label: copy.notice.signInAgain, onPress: () => router.push(connectHref('signed_out_notice')) },
};

/** iOS has no live regions, so VoiceOver hears the line announced; TalkBack hears Notice.tsx's live region. */
function speakLine(text: string) {
  if (Platform.OS === 'ios') announce(text);
}

const NoticeContext = createContext<Notices | null>(null);

/** The player's note, spoken once as it appears wherever the player is drawn (VIS-2). */
function SpokenNote() {
  const note = playerNote(usePlayer());
  useEffect(() => {
    if (note !== null) announce(note);
  }, [note]);
  return null;
}

export function NoticeProvider({ children }: { children: ReactNode }) {
  const { gather } = useAppState();
  const signedOut = gather.pausedReason === 'logged_out';
  const [line, setLine] = useState<NoticeLine | null>(null);
  const [signedOutDismissed, setSignedOutDismissed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { track } = useSharing();
  const screenReader = useScreenReader();
  const reading = useRef(screenReader);
  // A dismiss lasts until the phone is signed in again; set during render, so the reset lands before anything commits.
  if (!signedOut && signedOutDismissed) setSignedOutDismissed(false);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  // A screen reader turned on while a line counts down keeps it.
  useEffect(() => {
    reading.current = screenReader;
    if (screenReader && timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }, [screenReader]);

  const show = useCallback(
    (next: NoticeLine) => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
      setLine(next);
      const lifetime = noticeLifetime(reading.current, next.code === null);
      if (lifetime !== null) timer.current = setTimeout(() => setLine(null), lifetime);
      speakLine(next.text);
      if (next.code !== null) track({ name: 'notice_shown', props: { code: next.code } });
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
    speakLine(SIGNED_OUT.text);
    track({ name: 'notice_shown', props: { code: 'signed_out' } });
  }, [signedOut, signedOutShown, track]);

  const walk = useRef(gather);
  useEffect(() => {
    const milestone = catchUpMilestone(walk.current, gather);
    walk.current = gather;
    if (milestone !== null) announce(milestone);
  }, [gather]);

  const dismiss = useCallback(() => {
    if (line) setLine(null);
    else setSignedOutDismissed(true);
  }, [line]);

  const value = useMemo<Notices>(() => ({ notice, show, dismiss }), [notice, show, dismiss]);
  return (
    <NoticeContext.Provider value={value}>
      {children}
      <SpokenNote />
    </NoticeContext.Provider>
  );
}

export function useNotice(): Notices {
  const notices = useContext(NoticeContext);
  if (!notices) throw new Error('useNotice needs a NoticeProvider above it');
  return notices;
}

/**
 * The player as the chrome reads it (DESIGN-UI section 10, ADR-0015), split so a reader re-renders only on
 * what it draws: stable controls, the Release in the transport, the Track and its state, and the position ticks. The
 * transport's Tallies go to the sharing provider's `track`, naming the screen a play was pressed on. The
 * tree under it draws once the last-played Release is restored, so the iOS bar's accessory holds it from the first
 * frame (`useResume`).
 */
import { usePathname } from 'expo-router';
import { createContext, createElement, useCallback, useContext, useEffect, useMemo, useRef, type ReactNode } from 'react';

import type { PlayableRelease } from '@/player/transport';
import { useResume } from '@/player/useResume';
import { useTransport, type PlayerClock, type Transport } from '@/player/useTransport';
import { useAppState } from '@/state/appState';
import type { Screen } from '@/tally/catalogue';
import { useSharing } from '@/tally/Sharing';
import { screenFor } from '@/tally/tally';

export type PlayerActions = Pick<Transport, 'play' | 'toggle' | 'next' | 'previous' | 'seek' | 'playAt' | 'isPlaying'>;
/** The player as the chrome reads it; restoring and forgetting belong to the provider. */
export type Player = Omit<Transport, 'restore' | 'forget'>;

const PlayerContext = createContext<Player | null>(null);
const ActionsContext = createContext<PlayerActions | null>(null);
const ReleaseContext = createContext<PlayableRelease | null>(null);
const ClockContext = createContext<PlayerClock>({ position: 0, duration: 0 });

export function PlayerProvider({ children }: { children: ReactNode }) {
  const { track } = useSharing();
  const pathname = usePathname();
  const here = useRef<Screen>('other');
  useEffect(() => {
    here.current = screenFor(pathname);
  }, [pathname]);
  const screen = useCallback(() => here.current, []);
  const app = useAppState();
  const { transport, clock } = useTransport({ ...app, track, screen });
  const ready = useResume(transport, clock, app.db, app.gather.identity?.fanId ?? null);
  const { play, toggle, next, previous, seek, playAt, isPlaying, release } = transport;
  const actions = useMemo<PlayerActions>(
    () => ({ play, toggle, next, previous, seek, playAt, isPlaying }),
    [play, toggle, next, previous, seek, playAt, isPlaying],
  );
  const tree = createElement(ClockContext.Provider, { value: clock }, ready ? children : null);
  return createElement(
    ActionsContext.Provider,
    { value: actions },
    createElement(ReleaseContext.Provider, { value: release }, createElement(PlayerContext.Provider, { value: transport }, tree)),
  );
}

export function usePlayer(): Player {
  const player = useContext(PlayerContext);
  if (!player) throw new Error('usePlayer needs a PlayerProvider above it');
  return player;
}

export function usePlayerActions(): PlayerActions {
  const actions = useContext(ActionsContext);
  if (!actions) throw new Error('usePlayerActions needs a PlayerProvider above it');
  return actions;
}

/** The Release in the transport; its identity only changes when another Release is played. */
export function usePlayerRelease(): PlayableRelease | null {
  return useContext(ReleaseContext);
}

export function usePlayerClock(): PlayerClock {
  return useContext(ClockContext);
}

export function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

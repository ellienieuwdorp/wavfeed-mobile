/**
 * The player as the chrome reads it (DESIGN-UI section 10, ADR-0015, task 0036), split so a reader re-renders only on
 * what it draws: stable controls, the Release in the transport, the Track and its state, and the position ticks.
 */
import { createContext, createElement, useContext, useMemo, type ReactNode } from 'react';

import type { PlayableRelease } from '@/player/transport';
import { useTransport, type PlayerClock, type Transport } from '@/player/useTransport';
import { useAppState } from '@/state/appState';

export type { PlayableRelease, PlayerStatus } from '@/player/transport';
export type { PlayerClock } from '@/player/useTransport';
export type Player = Transport;
export type PlayerActions = Pick<Transport, 'play' | 'toggle' | 'next' | 'previous' | 'seek' | 'playAt'>;

const PlayerContext = createContext<Player | null>(null);
const ActionsContext = createContext<PlayerActions | null>(null);
const ReleaseContext = createContext<PlayableRelease | null>(null);
const ClockContext = createContext<PlayerClock>({ position: 0, duration: 0 });

export function PlayerProvider({ children }: { children: ReactNode }) {
  const { transport, clock } = useTransport(useAppState());
  const { play, toggle, next, previous, seek, playAt, current } = transport;
  const actions = useMemo<PlayerActions>(() => ({ play, toggle, next, previous, seek, playAt }), [play, toggle, next, previous, seek, playAt]);
  const tree = createElement(ClockContext.Provider, { value: clock }, children);
  return createElement(
    ActionsContext.Provider,
    { value: actions },
    createElement(ReleaseContext.Provider, { value: current }, createElement(PlayerContext.Provider, { value: transport }, tree)),
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

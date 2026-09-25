/**
 * The player as the chrome reads it (DESIGN-UI section 10, ADR-0015, task 0036): `usePlayer()` for the Release, the Track
 * and the controls, `usePlayerClock()` for position ticks, both fed from the app state mounted above this provider.
 */
import { createContext, createElement, useContext, type ReactNode } from 'react';

import { useTransport, type PlayerClock, type Transport } from '@/player/useTransport';
import { useAppState } from '@/state/appState';

export type { PlayableRelease, PlayerStatus } from '@/player/transport';
export type { PlayerClock } from '@/player/useTransport';
export type Player = Transport;

const PlayerContext = createContext<Player | null>(null);
const ClockContext = createContext<PlayerClock>({ position: 0, duration: 0 });

export function PlayerProvider({ children }: { children: ReactNode }) {
  const { transport, clock } = useTransport(useAppState());
  return createElement(PlayerContext.Provider, { value: transport }, createElement(ClockContext.Provider, { value: clock }, children));
}

export function usePlayer(): Player {
  const player = useContext(PlayerContext);
  if (!player) throw new Error('usePlayer needs a PlayerProvider above it');
  return player;
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

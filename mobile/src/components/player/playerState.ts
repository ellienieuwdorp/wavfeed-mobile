/**
 * The player's state as the chrome reads it (DESIGN-UI section 10, task 0036
 * decision 5): the playing Track, whether it plays, and the elapsed seconds. This
 * is a stub seeded with the canvas's sample Track; the player lane replaces the
 * body of `PlayerProvider` with the audio transport and keeps `usePlayer()`.
 */
import { createContext, createElement, useContext, useState, type ReactNode } from 'react';

export type Track = {
  n: number;
  title: string;
  artist: string;
  release: string;
  hue: number;
  duration: number;
  url?: string;
  on?: boolean;
};

export type Player = {
  current: Track | null;
  playing: boolean;
  position: number;
  toggle: () => void;
  setCurrent: (track: Track | null) => void;
};

const SAMPLE: Track = { n: 3, title: 'Distant Loop I', artist: 'Umlaut Convection', release: 'Distant Loop Systems', hue: 200, duration: 400, on: true };

const PlayerContext = createContext<Player | null>(null);

export function PlayerProvider({ children }: { children: ReactNode }) {
  const [current, setCurrent] = useState<Track | null>(SAMPLE);
  const [playing, setPlaying] = useState(true);
  const value: Player = { current, playing, position: 88, toggle: () => setPlaying((p) => !p), setCurrent };
  return createElement(PlayerContext.Provider, { value }, children);
}

export function usePlayer(): Player {
  const player = useContext(PlayerContext);
  if (!player) throw new Error('usePlayer needs a PlayerProvider above it');
  return player;
}

export function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/**
 * Starting audio on the transport's player (task 0047). expo-audio 57's `play()` activates the iOS audio session first
 * and throws when iOS refuses it, for an app not yet in the foreground or during a call; that throw is its only one,
 * and Android's `play()` never throws. Every start goes through `startAudio`, and a Track whose start was refused lands
 * loaded and paused at its index, which a load or a restart from rest names as `refused` in its `playback_started`.
 */
import type { PlayResult } from '@/tally/actions';

import type { PlayerStatus } from './transport';

/** The slice of expo-audio's `AudioPlayer` a start uses. */
export type StartingPlayer = {
  readonly replace: (source: { uri: string }) => void;
  readonly play: () => void;
  readonly seekTo?: (seconds: number) => Promise<void>;
};

type Startable = { readonly status: PlayerStatus; readonly index: number | null; readonly playing: boolean };

/** Whether audio started; a throw from `play()` is a refused session, whatever its message (task 0047 decision 1). */
export function startAudio(player: Pick<StartingPlayer, 'play'>): boolean {
  try {
    player.play();
    return true;
  } catch {
    return false;
  }
}

/**
 * Puts the stream at `uri` on the player and starts it. A refused start keeps the Track loaded at its index, paused,
 * until a press starts it (task 0047 decision 2). A null player is sample mode, which plays the state and never the
 * audio (task 0036) and so always starts. `at` seeks the new stream before it plays, for a Track restored at launch
 * (task 0071, Open 13).
 */
export function startAt<S extends Startable>(
  player: StartingPlayer | null,
  from: S,
  index: number,
  uri: string,
  at = 0,
): { next: S; result: Extract<PlayResult, 'playing' | 'refused'> } {
  let started = true;
  if (player !== null) {
    player.replace({ uri });
    if (at > 0) player.seekTo?.(at).catch(() => undefined);
    started = startAudio(player);
  }
  return { next: { ...from, status: 'ready', index, playing: started }, result: started ? 'playing' : 'refused' };
}

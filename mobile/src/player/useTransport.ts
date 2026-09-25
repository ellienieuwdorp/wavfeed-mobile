/**
 * The transport (DESIGN-UI section 10, ADR-0015, task 0036), following the web's PlayerContext.tsx: one expo-audio
 * player for the app's life, a play fetching the tracklist and starting the first streamable Track, the same Release
 * pressed again toggling pause, previous and next inside the Release, a Track ending advancing and the last one
 * stopping at rest. The lock screen and Control Centre get the Track through `setActiveForLockScreen`; expo-audio 57
 * gives them play, pause and scrubbing but no next or previous track command. Position ticks live in their own value
 * so the tab bar does not re-render four times a second.
 */
import { setAudioModeAsync, useAudioPlayer, type AudioPlayer, type AudioStatus } from 'expo-audio';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { SAMPLE_MODE } from '@/dev/sampleMode';
import type { ApiReleaseTrack } from '@/domain/apiTypes';

import {
  firstStreamableIndex,
  isSameRelease,
  isStreamable,
  loadTracklist,
  lockScreenMetadata,
  nextStreamableIndex,
  previousStreamableIndex,
  type PlayableRelease,
  type PlayerStatus,
  type TransportDeps,
} from './transport';

type TransportState = {
  readonly current: PlayableRelease | null;
  readonly status: PlayerStatus;
  readonly tracks: readonly ApiReleaseTrack[];
  readonly index: number | null;
  readonly playing: boolean;
  readonly expiresAt: number;
  readonly bandId: string | null;
};

export type Transport = {
  readonly current: PlayableRelease | null;
  readonly status: PlayerStatus;
  /** The Track in the transport; null while loading, when nothing can play, and at rest after the last one. */
  readonly track: ApiReleaseTrack | null;
  /** The Release's tracklist, empty while it first loads and when it failed; kept through a reload of the same Release. */
  readonly tracks: readonly ApiReleaseTrack[];
  readonly index: number | null;
  readonly playing: boolean;
  /** The Page the playing Release belongs to, which a wishlist write for its Track has to name (ADR-0016). */
  readonly bandId: string | null;
  readonly canPrevious: boolean;
  readonly canNext: boolean;
  readonly play: (release: PlayableRelease) => void;
  readonly toggle: () => void;
  readonly next: () => void;
  readonly previous: () => void;
  readonly seek: (seconds: number) => void;
  /** Starts the Track at `index`; the Track already in the transport toggles pause instead. */
  readonly playAt: (index: number) => void;
};

export type PlayerClock = { readonly position: number; readonly duration: number };

const IDLE: TransportState = { current: null, status: 'idle', tracks: [], index: null, playing: false, expiresAt: 0, bandId: null };
const ZERO: PlayerClock = { position: 0, duration: 0 };
const UPDATE_INTERVAL_MS = 250;
/** Status events already queued when a control is pressed still describe the moment before it. */
const QUIET_AFTER_CONTROL_MS = 600;

function expired(from: TransportState): boolean {
  return from.expiresAt !== 0 && Date.now() >= from.expiresAt;
}

function durationOf(status: AudioStatus | null, track: ApiReleaseTrack | undefined): number {
  if (status !== null && status.duration > 0) return status.duration;
  return track?.duration ?? 0;
}

function showOnLockScreen(audio: AudioPlayer, active: { current: boolean }, release: PlayableRelease, track: ApiReleaseTrack) {
  const metadata = lockScreenMetadata(release, track);
  try {
    if (active.current) audio.updateLockScreenMetadata(metadata);
    else audio.setActiveForLockScreen(true, metadata, { showSeekForward: false, showSeekBackward: false });
    active.current = true;
  } catch {
    active.current = false;
  }
}

export function useTransport(deps: TransportDeps): { transport: Transport; clock: PlayerClock } {
  const audio = useAudioPlayer(null, { updateInterval: UPDATE_INTERVAL_MS });
  const [state, setState] = useState<TransportState>(IDLE);
  const [clock, setClock] = useState<PlayerClock>(ZERO);
  const stateRef = useRef<TransportState>(IDLE);
  const depsRef = useRef(deps);
  const loadRef = useRef(0);
  const quietUntil = useRef(0);
  const lockActive = useRef(false);

  useEffect(() => {
    depsRef.current = deps;
  }, [deps]);

  useEffect(() => {
    setAudioModeAsync({ playsInSilentMode: true, shouldPlayInBackground: true, interruptionMode: 'doNotMix' }).catch(() => undefined);
  }, []);

  const apply = useCallback((next: TransportState) => {
    stateRef.current = next;
    setState(next);
  }, []);

  const quiet = useCallback(() => {
    quietUntil.current = Date.now() + QUIET_AFTER_CONTROL_MS;
  }, []);

  const beginPlayback = useCallback(
    (from: TransportState, index: number) => {
      const track = from.tracks[index];
      if (from.current === null || track === undefined || track.streamUrl === null) return;
      quiet();
      // The rig's streams are made up, so sample mode plays the state and never the audio (task 0036).
      if (!SAMPLE_MODE) {
        audio.replace({ uri: track.streamUrl });
        audio.play();
      }
      apply({ ...from, status: 'ready', index, playing: true });
      setClock({ position: 0, duration: durationOf(null, track) });
      showOnLockScreen(audio, lockActive, from.current, track);
    },
    [apply, audio, quiet],
  );

  const loadAndStart = useCallback(
    async (release: PlayableRelease, wantedTrackId: string | null, force: boolean) => {
      loadRef.current += 1;
      const token = loadRef.current;
      const before = stateRef.current;
      const kept = force && before.current !== null && isSameRelease(before.current, release) ? before.tracks : [];
      quiet();
      audio.pause();
      apply({ ...IDLE, current: release, status: 'loading', tracks: kept });
      setClock(ZERO);
      const tracklist = await loadTracklist(depsRef.current, release, force).catch(() => null);
      if (loadRef.current !== token) return;
      if (tracklist === null) {
        apply({ ...IDLE, current: release, status: 'error' });
        return;
      }
      const wanted = tracklist.tracks.findIndex((track) => track.trackId === wantedTrackId && isStreamable(track));
      const index = wanted === -1 ? firstStreamableIndex(tracklist.tracks) : wanted;
      const expiresAt = Date.parse(tracklist.expiresAt);
      const loaded: TransportState = {
        current: release,
        status: 'ready',
        tracks: tracklist.tracks,
        index: null,
        playing: false,
        expiresAt: Number.isNaN(expiresAt) ? 0 : expiresAt,
        bandId: tracklist.bandId,
      };
      if (index === null) apply({ ...loaded, status: 'unplayable' });
      else beginPlayback(loaded, index);
    },
    [apply, audio, beginPlayback, quiet],
  );

  const startTrack = useCallback(
    (index: number) => {
      const from = stateRef.current;
      const track = from.tracks[index];
      if (from.current === null || track === undefined || track.streamUrl === null) return;
      if (expired(from)) void loadAndStart(from.current, track.trackId, true);
      else beginPlayback(from, index);
    },
    [beginPlayback, loadAndStart],
  );

  const toggle = useCallback(() => {
    const from = stateRef.current;
    if (from.status !== 'ready' || from.current === null) return;
    quiet();
    if (from.playing) {
      audio.pause();
      apply({ ...from, playing: false });
      return;
    }
    if (from.index !== null && !expired(from)) {
      audio.play();
      apply({ ...from, playing: true });
      return;
    }
    const index = from.index ?? firstStreamableIndex(from.tracks);
    if (index !== null) startTrack(index);
  }, [apply, audio, quiet, startTrack]);

  const play = useCallback(
    (release: PlayableRelease) => {
      const from = stateRef.current;
      if (from.current !== null && isSameRelease(from.current, release) && (from.status === 'ready' || from.status === 'loading')) {
        toggle();
        return;
      }
      void loadAndStart(release, null, false);
    },
    [loadAndStart, toggle],
  );

  const playAt = useCallback(
    (index: number) => {
      const from = stateRef.current;
      if (from.status !== 'ready') return;
      if (from.index === index) toggle();
      else startTrack(index);
    },
    [startTrack, toggle],
  );

  const next = useCallback(() => {
    const from = stateRef.current;
    const to = from.index === null ? null : nextStreamableIndex(from.tracks, from.index);
    if (to !== null) startTrack(to);
  }, [startTrack]);

  const previous = useCallback(() => {
    const from = stateRef.current;
    const to = from.index === null ? null : previousStreamableIndex(from.tracks, from.index);
    if (to !== null) startTrack(to);
  }, [startTrack]);

  const seek = useCallback(
    (seconds: number) => {
      if (stateRef.current.index === null) return;
      audio.seekTo(seconds).catch(() => undefined);
      setClock((at) => ({ ...at, position: seconds }));
    },
    [audio],
  );

  useEffect(() => {
    const subscription = audio.addListener('playbackStatusUpdate', (status) => {
      const from = stateRef.current;
      if (from.status !== 'ready' || from.index === null) return;
      if (status.didJustFinish) {
        const to = nextStreamableIndex(from.tracks, from.index);
        if (to !== null) {
          startTrack(to);
          return;
        }
        apply({ ...from, index: null, playing: false });
        setClock(ZERO);
        return;
      }
      if (status.error) {
        audio.pause();
        apply({ ...from, status: 'error', playing: false });
        return;
      }
      setClock({ position: status.currentTime, duration: durationOf(status, from.tracks[from.index]) });
      // Play and pause that came from outside the app: the lock screen, Control Centre, a phone call.
      if (Date.now() < quietUntil.current) return;
      if (status.playing && !from.playing) apply({ ...from, playing: true });
      const halted = status.isLoaded && !status.isBuffering && status.timeControlStatus === 'paused';
      if (!status.playing && halted && from.playing) apply({ ...from, playing: false });
    });
    return () => subscription.remove();
  }, [apply, audio, startTrack]);

  const track = state.index === null ? null : (state.tracks[state.index] ?? null);
  const transport = useMemo<Transport>(
    () => ({
      current: state.current,
      status: state.status,
      track,
      tracks: state.tracks,
      index: state.index,
      playing: state.playing,
      bandId: state.bandId,
      canPrevious: state.index !== null && previousStreamableIndex(state.tracks, state.index) !== null,
      canNext: state.index !== null && nextStreamableIndex(state.tracks, state.index) !== null,
      play,
      toggle,
      next,
      previous,
      seek,
      playAt,
    }),
    [state, track, play, toggle, next, previous, seek, playAt],
  );
  return { transport, clock };
}

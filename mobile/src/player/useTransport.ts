/**
 * The transport (DESIGN-UI section 10, ADR-0015, task 0036), following the web's PlayerContext.tsx: one expo-audio
 * player for the app's life, a play fetching the tracklist and starting the first streamable Track, the same Release
 * pressed again toggling pause, previous and next inside the Release, a Track ending advancing and the last one
 * stopping at rest. The lock screen and Control Centre get the Track through `setActiveForLockScreen`; expo-audio 57
 * gives them play, pause and scrubbing but no next or previous track command. Position ticks live in their own value
 * so the tab bar does not re-render four times a second. A play's start, a stream that dies mid-Track and the listening
 * a Release got go to `track` as Tallies (task 0038, `src/tally/actions.ts`).
 */
import { setAudioModeAsync, useAudioPlayer, type AudioPlayer, type AudioStatus } from 'expo-audio';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { SAMPLE_MODE } from '@/dev/sampleMode';
import type { ApiReleaseTrack } from '@/domain/apiTypes';
import { listenStep, playbackStarted, type Listening, type ListenEvent, type PlayResult } from '@/tally/actions';
import type { Screen, Tally } from '@/tally/catalogue';

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
  readonly release: PlayableRelease | null;
  readonly status: PlayerStatus;
  readonly tracks: readonly ApiReleaseTrack[];
  readonly index: number | null;
  readonly playing: boolean;
  readonly expiresAt: number;
  readonly bandId: string | null;
};

export type Transport = {
  readonly release: PlayableRelease | null;
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
  /**
   * Starts at the Track `from` names when it streams, else the first that does (a Drop's row, task 0041 decision 10).
   * `screen` names where the play began when the pathname cannot yet, as in an effect on a screen that just mounted.
   */
  readonly play: (release: PlayableRelease, from?: string | null, screen?: Screen) => void;
  readonly toggle: () => void;
  readonly next: () => void;
  readonly previous: () => void;
  readonly seek: (seconds: number) => void;
  /** Starts the Track at `index`; the Track already in the transport toggles pause instead. */
  readonly playAt: (index: number) => void;
  /** Whether audio plays now, read at a press without re-rendering on every change. */
  readonly isPlaying: () => boolean;
};

/** Where the player's Tallies go, and the screen a play was pressed on. */
export type TransportTallies = { readonly track: (tally: Tally) => void; readonly screen: () => Screen };

export type PlayerClock = { readonly position: number; readonly duration: number };

const IDLE: TransportState = { release: null, status: 'idle', tracks: [], index: null, playing: false, expiresAt: 0, bandId: null };
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

function releaseKey(release: PlayableRelease): string {
  return `${release.itemType}:${release.itemId}`;
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

export function useTransport(deps: TransportDeps & TransportTallies): { transport: Transport; clock: PlayerClock } {
  // expo-audio deactivates the iOS audio session 100 ms after a pause or a Track's end unless something is playing,
  // and the next Track is still buffering then; in the background an inactive session gets the app suspended before
  // it starts. Keeping the session active is what lets a Release play on with the screen locked (task 0036).
  const audio = useAudioPlayer(null, { updateInterval: UPDATE_INTERVAL_MS, keepAudioSessionActive: true });
  const [state, setState] = useState<TransportState>(IDLE);
  const [clock, setClock] = useState<PlayerClock>(ZERO);
  const stateRef = useRef<TransportState>(IDLE);
  const depsRef = useRef(deps);
  const loadRef = useRef(0);
  const quietUntil = useRef(0);
  const lockActive = useRef(false);
  /** The position a seek is travelling to; status ticks report the old position until AVPlayer lands it. */
  const seekingTo = useRef<number | null>(null);
  const listening = useRef<Listening | null>(null);

  useEffect(() => {
    depsRef.current = deps;
  }, [deps]);

  useEffect(() => {
    setAudioModeAsync({ playsInSilentMode: true, shouldPlayInBackground: true, interruptionMode: 'doNotMix' }).catch(() => undefined);
  }, []);

  const listen = useCallback((event: ListenEvent) => {
    const step = listenStep(listening.current, event, Date.now());
    listening.current = step.listening;
    if (step.tally !== null) depsRef.current.track(step.tally);
  }, []);

  const apply = useCallback(
    (next: TransportState) => {
      stateRef.current = next;
      setState(next);
      listen({ kind: 'playing', on: next.status === 'ready' && next.playing });
    },
    [listen],
  );

  const quiet = useCallback(() => {
    quietUntil.current = Date.now() + QUIET_AFTER_CONTROL_MS;
  }, []);

  const beginPlayback = useCallback(
    (from: TransportState, index: number) => {
      const track = from.tracks[index];
      if (from.release === null || track === undefined || track.streamUrl === null) return;
      quiet();
      seekingTo.current = null;
      listen({ kind: 'start', release: releaseKey(from.release) });
      // The rig's streams are made up, so sample mode plays the state and never the audio (task 0036).
      if (!SAMPLE_MODE) {
        audio.replace({ uri: track.streamUrl });
        audio.play();
      }
      apply({ ...from, status: 'ready', index, playing: true });
      setClock({ position: 0, duration: durationOf(null, track) });
      showOnLockScreen(audio, lockActive, from.release, track);
    },
    [apply, audio, listen, quiet],
  );

  const loadAndStart = useCallback(
    async (release: PlayableRelease, wantedTrackId: string | null, force: boolean, pressedOn?: Screen) => {
      loadRef.current += 1;
      const token = loadRef.current;
      const before = stateRef.current;
      const same = before.release !== null && isSameRelease(before.release, release);
      const kept = force && same ? before.tracks : [];
      const startedAt = Date.now();
      const screen = pressedOn ?? depsRef.current.screen();
      // A reload of the Release already in the transport, after an error or once its stream URLs expired, is a retry.
      const started = (result: PlayResult) => depsRef.current.track(playbackStarted(result, Date.now() - startedAt, screen, same));
      listen({ kind: 'load', release: releaseKey(release) });
      quiet();
      audio.pause();
      apply({ ...IDLE, release, status: 'loading', tracks: kept });
      setClock(ZERO);
      const tracklist = await loadTracklist(depsRef.current, release, force).catch(() => null);
      if (loadRef.current !== token) return;
      if (tracklist === null) {
        apply({ ...IDLE, release, status: 'error' });
        started('error');
        return;
      }
      const wanted = tracklist.tracks.findIndex((track) => track.trackId === wantedTrackId && isStreamable(track));
      const index = wanted === -1 ? firstStreamableIndex(tracklist.tracks) : wanted;
      const expiresAt = Date.parse(tracklist.expiresAt);
      const loaded: TransportState = {
        release,
        status: 'ready',
        tracks: tracklist.tracks,
        index: null,
        playing: false,
        expiresAt: Number.isNaN(expiresAt) ? 0 : expiresAt,
        bandId: tracklist.bandId,
      };
      if (index === null) {
        apply({ ...loaded, status: 'unplayable' });
        started('unplayable');
      } else {
        beginPlayback(loaded, index);
        started('playing');
      }
    },
    [apply, audio, beginPlayback, listen, quiet],
  );

  const startTrack = useCallback(
    (index: number) => {
      const from = stateRef.current;
      const track = from.tracks[index];
      if (from.release === null || track === undefined || track.streamUrl === null) return;
      if (expired(from)) void loadAndStart(from.release, track.trackId, true);
      else beginPlayback(from, index);
    },
    [beginPlayback, loadAndStart],
  );

  const toggle = useCallback(() => {
    const from = stateRef.current;
    if (from.status !== 'ready' || from.release === null) return;
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
    if (index === null) return;
    // A Release at rest after its last Track starts again from here; an expired one reloads and counts itself.
    if (from.index === null && !expired(from)) depsRef.current.track(playbackStarted('playing', 0, depsRef.current.screen(), false));
    startTrack(index);
  }, [apply, audio, quiet, startTrack]);

  const play = useCallback(
    (release: PlayableRelease, wantedTrackId: string | null = null, screen?: Screen) => {
      const from = stateRef.current;
      if (from.release !== null && isSameRelease(from.release, release) && (from.status === 'ready' || from.status === 'loading')) {
        toggle();
        return;
      }
      void loadAndStart(release, wantedTrackId, false, screen);
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
      seekingTo.current = seconds;
      setClock((at) => ({ ...at, position: seconds }));
      audio
        .seekTo(seconds)
        .catch(() => undefined)
        .finally(() => {
          if (seekingTo.current === seconds) seekingTo.current = null;
        });
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
        listen({ kind: 'end' });
        apply({ ...from, index: null, playing: false });
        setClock(ZERO);
        return;
      }
      if (status.error) {
        audio.pause();
        apply({ ...from, status: 'error', playing: false });
        depsRef.current.track({ name: 'playback_failed', props: { stage: 'mid_track' } });
        return;
      }
      const position = seekingTo.current ?? status.currentTime;
      setClock({ position, duration: durationOf(status, from.tracks[from.index]) });
      // Play and pause that came from outside the app: the lock screen, Control Centre, a phone call.
      if (Date.now() < quietUntil.current) return;
      if (status.playing && !from.playing) apply({ ...from, playing: true });
      const halted = status.isLoaded && !status.isBuffering && status.timeControlStatus === 'paused';
      if (!status.playing && halted && from.playing) apply({ ...from, playing: false });
    });
    return () => subscription.remove();
  }, [apply, audio, listen, startTrack]);

  const isPlaying = useCallback(() => stateRef.current.playing, []);

  const track = state.index === null ? null : (state.tracks[state.index] ?? null);
  const transport = useMemo<Transport>(
    () => ({
      release: state.release,
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
      isPlaying,
    }),
    [state, track, play, toggle, next, previous, seek, playAt, isPlaying],
  );
  return { transport, clock };
}

/**
 * The transport (DESIGN-UI section 10, ADR-0015), following the web's PlayerContext.tsx: one expo-audio
 * player for the app's life, a play fetching the tracklist and starting the first streamable Track, the same Release
 * pressed again toggling pause unless a Drop names another Track, previous and next inside the Release,
 * a Track ending advancing and the last one stopping at rest. The lock screen and Control Centre get the Track
 * through `setActiveForLockScreen`; expo-audio 57 gives them play, pause and scrubbing but no next or previous track command. Position ticks live in their own value
 * so the tab bar does not re-render four times a second. A play's start, a stream that dies mid-Track and the listening
 * a Release got go to `track` as Tallies (`src/tally/actions.ts`). A launch can `restore` the last-played
 * Release paused: its Track sits at its index with no stream on the audio player, no audio session
 * taken and nothing on the lock screen, until a press starts that Track at the saved position, reading the page afresh
 * first when its stream URLs have expired (`resume.ts`).
 */
import { setAudioModeAsync, useAudioPlayer, type AudioPlayer, type AudioStatus } from 'expo-audio';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { SAMPLE_MODE } from '@/dev/sampleMode';
import type { Track } from '@/domain/views';
import { listenStep, playbackStarted, type Listening, type PlayerChange, type PlayResult } from '@/tally/actions';
import type { Screen, Tally } from '@/tally/catalogue';

import type { Resume } from './resume';
import { startAt, startAudio } from './start';
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
  readonly tracks: readonly Track[];
  readonly index: number | null;
  readonly playing: boolean;
  readonly expiresAt: number;
  readonly bandId: string | null;
};

export type Transport = {
  readonly release: PlayableRelease | null;
  readonly status: PlayerStatus;
  /** The Track in the transport; null while loading, when nothing can play, and at rest after the last one. */
  readonly track: Track | null;
  /** The Release's tracklist, empty while it first loads and when it failed; kept through a reload of the same Release. */
  readonly tracks: readonly Track[];
  readonly index: number | null;
  readonly playing: boolean;
  /** The Page the playing Release belongs to, which a wishlist write for its Track has to name (ADR-0016). */
  readonly bandId: string | null;
  readonly canPrevious: boolean;
  readonly canNext: boolean;
  /**
   * Starts at the Track `from` names when it streams, else the first that does (a Drop's row).
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
  /** Puts a saved Release in the transport, paused, while nothing else is in it; touches no audio. */
  readonly restore: (resume: Resume) => void;
  /** Empties the transport, as when the store's Fan changes under it. */
  readonly forget: () => void;
};

/** Where the player's Tallies go, and the screen a play was pressed on. */
export type TransportTallies = { readonly track: (tally: Tally) => void; readonly screen: () => Screen };

export type PlayerClock = { readonly position: number; readonly duration: number };

/** Where a restored Release starts: its Track (null for one at rest) and the position in it. */
type ResumeStart = { readonly release: PlayableRelease; readonly trackId: string | null; readonly at: number };

const IDLE: TransportState = { release: null, status: 'idle', tracks: [], index: null, playing: false, expiresAt: 0, bandId: null };
const ZERO: PlayerClock = { position: 0, duration: 0 };
const UPDATE_INTERVAL_MS = 250;
/** Status events already queued when a control is pressed still describe the moment before it. */
const QUIET_AFTER_CONTROL_MS = 600;

function expired(from: TransportState): boolean {
  return from.expiresAt !== 0 && Date.now() >= from.expiresAt;
}

function durationOf(status: AudioStatus | null, track: Track | undefined): number {
  if (status !== null && status.duration > 0) return status.duration;
  return track?.duration ?? 0;
}

function releaseKey(release: PlayableRelease): string {
  return `${release.itemType}:${release.itemId}`;
}

function showOnLockScreen(audio: AudioPlayer, active: { current: boolean }, release: PlayableRelease, track: Track) {
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
  // it starts. Keeping the session active is what lets a Release play on with the screen locked.
  const audio = useAudioPlayer(null, { updateInterval: UPDATE_INTERVAL_MS, keepAudioSessionActive: true });
  const [state, setState] = useState<TransportState>(IDLE);
  const [clock, setClock] = useState<PlayerClock>(ZERO);
  const stateRef = useRef<TransportState>(IDLE);
  const depsRef = useRef(deps);
  const loadRef = useRef(0);
  const wantedTrackRef = useRef<string | null>(null);
  const quietUntil = useRef(0);
  const lockActive = useRef(false);
  /** The position a seek is travelling to; status ticks report the old position until AVPlayer lands it. */
  const seekingTo = useRef<number | null>(null);
  const listening = useRef<Listening | null>(null);
  /**
   * A restored Release not started yet: the Track and position a press starts it at. It outlives a failed fresh read, so
   * the retry starts there too, and only a start, another Release or another Track's press clears it.
   */
  const resumeStart = useRef<ResumeStart | null>(null);
  /** A start's resume position still to be confirmed once its stream has loaded, as a seek before then can be dropped. */
  const startSeek = useRef<number | null>(null);

  useEffect(() => {
    depsRef.current = deps;
  }, [deps]);

  useEffect(() => {
    setAudioModeAsync({ playsInSilentMode: true, shouldPlayInBackground: true, interruptionMode: 'doNotMix' }).catch(() => undefined);
  }, []);

  const listen = useCallback((change: PlayerChange) => {
    const step = listenStep(listening.current, change, Date.now());
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

  /**
   * Starts the Track at `index`, `at` seconds in, and answers whether its audio started; null when that index cannot
   * start.
   */
  const beginPlayback = useCallback(
    (from: TransportState, index: number, at = 0) => {
      const track = from.tracks[index];
      if (from.release === null || track === undefined || track.streamUrl === null) return null;
      quiet();
      resumeStart.current = null;
      seekingTo.current = at > 0 ? at : null;
      startSeek.current = null;
      // A refused start opens the listen too, and the paused state applied below settles it.
      listen({ kind: 'start', release: releaseKey(from.release) });
      // The rig's streams are made up, so sample mode plays the state and never the audio.
      const start = startAt(SAMPLE_MODE ? null : audio, from, index, track.streamUrl, at);
      // AVPlayer can drop a seek sent before the stream loads; the first loaded status checks it landed.
      if (at > 0 && !SAMPLE_MODE) startSeek.current = at;
      apply(start.next);
      setClock({ position: at, duration: durationOf(null, track) });
      showOnLockScreen(audio, lockActive, from.release, track);
      return start.result;
    },
    [apply, audio, listen, quiet],
  );

  const loadAndStart = useCallback(
    async (release: PlayableRelease, wantedTrackId: string | null, force: boolean, pressedOn?: Screen) => {
      loadRef.current += 1;
      const token = loadRef.current;
      const before = stateRef.current;
      const resume = resumeStart.current;
      const resuming = resume !== null && isSameRelease(resume.release, release) && (wantedTrackId === null || wantedTrackId === resume.trackId);
      if (!resuming) resumeStart.current = null;
      wantedTrackRef.current = resuming && wantedTrackId === null ? resume.trackId : wantedTrackId;
      const same = before.release !== null && isSameRelease(before.release, release);
      const kept = force && same ? before.tracks : [];
      const startedAt = Date.now();
      const screen = pressedOn ?? depsRef.current.screen();
      // A reload of the Release already in the transport, after an error or once its stream URLs expired, is a retry;
      // the first press on a restored Release is not, expired or not.
      const retried = same && !(before.status === 'ready' && resume !== null);
      const started = (result: PlayResult) => depsRef.current.track(playbackStarted(result, Date.now() - startedAt, screen, retried));
      listen({ kind: 'load', release: releaseKey(release) });
      quiet();
      audio.pause();
      apply({ ...IDLE, release, status: 'loading', tracks: kept });
      setClock(ZERO);
      let tracklist = await loadTracklist(depsRef.current, release, force).catch(() => null);
      if (loadRef.current !== token) return;
      if (tracklist !== null && !force && wantedTrackRef.current !== null &&
        !tracklist.tracks.some((track) => track.trackId === wantedTrackRef.current && isStreamable(track))) {
        // A pending Drop target can outgrow the first page; read fresh once under this load's token.
        tracklist = await loadTracklist(depsRef.current, release, true).catch(() => null);
        if (loadRef.current !== token) return;
      }
      if (tracklist === null) {
        apply({ ...IDLE, release, status: 'error' });
        started('error');
        return;
      }
      const wanted = tracklist.tracks.findIndex((track) => track.trackId === wantedTrackRef.current && isStreamable(track));
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
        // A restored Track starts where it was left; any other Track starts from its beginning.
        const held = resumeStart.current;
        const at = held !== null && held.trackId === tracklist.tracks[index]?.trackId ? held.at : 0;
        const result = beginPlayback(loaded, index, at);
        if (result !== null) started(result);
      }
    },
    [apply, audio, beginPlayback, listen, quiet],
  );

  /** Starts the Track at `index`, answering as `beginPlayback` does; null too when expired URLs send it to a reload. */
  const startTrack = useCallback(
    (index: number, at = 0) => {
      const from = stateRef.current;
      const track = from.tracks[index];
      if (from.release === null || track === undefined || track.streamUrl === null) return null;
      if (!expired(from)) return beginPlayback(from, index, at);
      void loadAndStart(from.release, track.trackId, true);
      return null;
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
    const restored = from.index === null ? null : (resumeStart.current?.at ?? null);
    if (from.index !== null && restored === null && !expired(from)) {
      // A refused resume leaves the Track paused.
      if (startAudio(audio)) apply({ ...from, playing: true });
      return;
    }
    const index = from.index ?? firstStreamableIndex(from.tracks);
    if (index === null) return;
    // A Release at rest after its last Track, or restored at launch, starts from here and counts the start, a refused
    // one as `refused`; an expired one reloads and counts itself, so
    // `startTrack` answers null.
    const result = startTrack(index, restored ?? 0);
    if (result !== null) depsRef.current.track(playbackStarted(result, 0, depsRef.current.screen(), false));
  }, [apply, audio, quiet, startTrack]);

  const play = useCallback(
    (release: PlayableRelease, wantedTrackId: string | null = null, screen?: Screen) => {
      const from = stateRef.current;
      if (from.release !== null && isSameRelease(from.release, release)) {
        if (from.status === 'loading') {
          // The active load starts the latest explicit Drop target; an ordinary art press keeps it.
          if (wantedTrackId !== null) wantedTrackRef.current = wantedTrackId;
          return;
        }
        if (from.status === 'ready') {
          if (wantedTrackId === null || (from.index !== null && from.tracks[from.index]?.trackId === wantedTrackId)) toggle();
          else {
            const index = from.tracks.findIndex((track) => track.trackId === wantedTrackId && isStreamable(track));
            // A newer Drop can name a Track the held page does not yet stream.
            if (index === -1) void loadAndStart(release, wantedTrackId, true, screen);
            else startTrack(index);
          }
          return;
        }
      }
      void loadAndStart(release, wantedTrackId, false, screen);
    },
    [loadAndStart, startTrack, toggle],
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
      const resume = resumeStart.current;
      if (resume !== null) {
        // A restored Track has no stream on the player yet; the press that starts it starts here.
        resumeStart.current = { ...resume, at: seconds };
        setClock((at) => ({ ...at, position: seconds }));
        return;
      }
      // This seek owns the position now, so the start's check on its first loaded status does not pull it back.
      startSeek.current = null;
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
      if (from.status !== 'ready' || from.index === null || resumeStart.current !== null) return;
      const target = startSeek.current;
      if (target !== null && status.isLoaded) {
        startSeek.current = null;
        if (Math.abs(status.currentTime - target) > 1) {
          seekingTo.current = target;
          audio
            .seekTo(target)
            .catch(() => undefined)
            .finally(() => {
              if (seekingTo.current === target) seekingTo.current = null;
            });
        } else if (seekingTo.current === target) seekingTo.current = null;
      }
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

  const restore = useCallback(
    (resume: Resume) => {
      if (stateRef.current.release !== null) return;
      const expiresAt = Date.parse(resume.tracklist.expiresAt);
      const track = resume.index === null ? undefined : resume.tracklist.tracks[resume.index];
      resumeStart.current = { release: resume.release, trackId: track?.trackId ?? null, at: track === undefined ? 0 : resume.position };
      apply({
        release: resume.release,
        status: 'ready',
        tracks: resume.tracklist.tracks,
        index: resume.index,
        playing: false,
        expiresAt: Number.isNaN(expiresAt) ? 0 : expiresAt,
        bandId: resume.tracklist.bandId,
      });
      setClock(track === undefined ? ZERO : { position: resume.position, duration: durationOf(null, track) });
    },
    [apply],
  );

  const forget = useCallback(() => {
    if (stateRef.current.release === null) return;
    loadRef.current += 1;
    resumeStart.current = null;
    startSeek.current = null;
    seekingTo.current = null;
    quiet();
    audio.pause();
    if (lockActive.current) {
      try {
        audio.clearLockScreenControls();
      } catch {
        // Nothing on the lock screen to clear.
      }
      lockActive.current = false;
    }
    apply(IDLE);
    setClock(ZERO);
  }, [apply, audio, quiet]);

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
      restore,
      forget,
    }),
    [state, track, play, toggle, next, previous, seek, playAt, isPlaying, restore, forget],
  );
  return { transport, clock };
}

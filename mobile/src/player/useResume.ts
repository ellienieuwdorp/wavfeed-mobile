/**
 * Keeps the last-played Release for the next launch (task 0071, decision 3 and Open 13, answered 2026-10-15): restores
 * it into the transport before the chrome first draws, saves it on a start, a pause and a Track change, every 10 s
 * while playing and on leaving the foreground, and empties the transport when the store's Fan changes under it, as a
 * sign-in does after the Demo. Saves are kept under the Fan, so neither the Demo nor an account restores the other's.
 */
import type { SQLiteDatabase } from 'expo-sqlite';
import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { loadResume, savedPlayback, savePlayback } from './resume';
import type { PlayerClock, Transport } from './useTransport';

export const SAVE_EVERY_MS = 10_000;
/** The longest a launch holds the chrome for the restore read; a slower read restores nothing this launch. */
export const RESTORE_WAIT_MS = 1_500;

/** Whether the restore has settled, so the chrome draws its first frame with what it restored. */
export function useResume(transport: Transport, clock: PlayerClock, db: SQLiteDatabase, fanId: number | null): boolean {
  const [ready, setReady] = useState(false);
  const [launchFan] = useState(fanId);
  const clockRef = useRef(clock);
  const { restore, forget } = transport;

  useEffect(() => {
    clockRef.current = clock;
  }, [clock]);

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<null>((done) => {
      timer = setTimeout(() => done(null), RESTORE_WAIT_MS);
    });
    void Promise.race([loadResume(db, launchFan), late])
      .catch(() => null)
      .then((resume) => {
        clearTimeout(timer);
        if (!alive) return;
        if (resume !== null) restore(resume);
        setReady(true);
      });
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [db, launchFan, restore]);

  const save = useEffectEvent(() => {
    if (!ready || fanId === null || transport.status !== 'ready' || transport.release === null) return;
    const trackId = transport.track?.trackId ?? null;
    void savePlayback(db, savedPlayback(fanId, transport.release, trackId, clockRef.current.position)).catch(() => undefined);
  });

  useEffect(() => {
    save();
  }, [ready, transport.release, transport.index, transport.playing, transport.status]);

  useEffect(() => {
    if (!transport.playing) return;
    const timer = setInterval(() => save(), SAVE_EVERY_MS);
    return () => clearInterval(timer);
  }, [transport.playing]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => {
      if (next !== 'active') save();
    });
    return () => subscription.remove();
  }, []);

  const fanSeen = useRef(fanId);
  useEffect(() => {
    if (fanSeen.current !== null && fanId !== fanSeen.current) forget();
    fanSeen.current = fanId;
  }, [fanId, forget]);

  return ready;
}

/**
 * The simulator rig's gate (task 0036): under `SAMPLE_MODE` it fills an empty store with the sample before anything
 * under it mounts, so Connect never presents itself, and the root layout hands the app state no gather runner. Any
 * other bundle passes straight through. `useSampleStart` puts the showcase Release in the player for `sim.sh play`,
 * and a `walk` parameter on any deep link stores the rig's first walk mid-way (`1`) or finishes it (`0`), for the
 * catch-up's checks (task 0040).
 */
import { useGlobalSearchParams } from 'expo-router';
import { useEffect, useRef, useState, type ReactNode } from 'react';

import { toPlayable } from '@/components/playable';
import { usePlayerActions } from '@/components/player/playerState';
import { useAppState } from '@/state/appState';
import { loadGatherState } from '@/state/gatherSink';
import { countRawDocuments } from '@/store';

import { loadSampleData, sampleShowcase, setSampleWalk } from './sample';
import { SAMPLE_MODE } from './sampleMode';

/** True once the store holds the sample, at once outside sample mode. */
export function useSampleData(): boolean {
  const { db, setGather, invalidate } = useAppState();
  const [ready, setReady] = useState(!SAMPLE_MODE);
  useEffect(() => {
    if (!SAMPLE_MODE) return;
    let alive = true;
    void (async () => {
      if ((await countRawDocuments(db)) === 0) {
        const started = Date.now();
        await loadSampleData(db);
        console.log('sample data loaded in', Date.now() - started, 'ms');
      }
      await loadGatherState({ db, setGather, invalidate });
      invalidate();
    })()
      .catch((error: unknown) => console.warn('sample data failed:', error instanceof Error ? error.message : String(error)))
      .finally(() => {
        if (alive) setReady(true);
      });
    return () => {
      alive = false;
    };
  }, [db, setGather, invalidate]);
  return ready;
}

function useSampleWalk(ready: boolean): void {
  const { walk } = useGlobalSearchParams<{ walk?: string }>();
  const { db, setGather, invalidate } = useAppState();
  useEffect(() => {
    if (!SAMPLE_MODE || !ready || (walk !== '1' && walk !== '0')) return;
    setSampleWalk({ db, setGather, invalidate }, walk === '1').catch((error: unknown) =>
      console.warn('sample walk failed:', error instanceof Error ? error.message : String(error)),
    );
  }, [ready, walk, db, setGather, invalidate]);
}

/** Holds its children back until the sample is in. */
export function SampleGate({ children }: { children: ReactNode }): ReactNode {
  const ready = useSampleData();
  useSampleWalk(ready);
  return ready ? children : null;
}

/** Plays the sample's showcase Release once when `on`; the transport starts no audio in sample mode. */
export function useSampleStart(on: boolean): void {
  const { play } = usePlayerActions();
  const started = useRef(false);
  useEffect(() => {
    if (!SAMPLE_MODE || !on || started.current) return;
    started.current = true;
    const release = sampleShowcase();
    if (release !== null) play(toPlayable(release));
  }, [on, play]);
}

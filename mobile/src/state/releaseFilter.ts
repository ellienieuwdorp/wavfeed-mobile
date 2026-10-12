/**
 * The New releases filter as one store the screen, its circle and the Filters sheet share (task 0071, decisions 5 to
 * 9): the settings read once per store from `kv` and written back on every change, and the last filtered view the
 * screen drew, so the sheet's counts are the list's (decision 21) without reading the store a second time. The sheet
 * is its own route, so the screen publishes what it filtered and the sheet subscribes.
 */
import type { SQLiteDatabase } from 'expo-sqlite';
import { useEffect, useSyncExternalStore } from 'react';

import type { FilteredNewReleases } from '@/domain/releaseFilter';
import { reportCode } from '@/tally/errors';

import { useAppState } from './appState';
import { readFilterSettings, writeFilterSettings, type FilterSettings } from './filterSettings';

type Snapshot = {
  readonly db: SQLiteDatabase | null;
  readonly loaded: boolean;
  readonly settings: FilterSettings | null;
  readonly filtered: FilteredNewReleases | null;
};

let snapshot: Snapshot = { db: null, loaded: false, settings: null, filtered: null };
const listeners = new Set<() => void>();

function publish(next: Snapshot): void {
  snapshot = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** A store opened afresh, after "Remove everything gathered" or the Demo, starts from what its own `kv` holds. */
function loadFor(db: SQLiteDatabase): void {
  if (snapshot.db === db) return;
  publish({ db, loaded: false, settings: null, filtered: null });
  readFilterSettings(db).then(
    (settings) => {
      if (snapshot.db === db) publish({ ...snapshot, loaded: true, settings });
    },
    (error: unknown) => {
      reportCode('query_failed', error);
      if (snapshot.db === db) publish({ ...snapshot, loaded: true });
    },
  );
}

export type ReleaseFilterState = {
  /** False until the saved settings have been read; the circle waits for it, so a first tap is never misread. */
  readonly loaded: boolean;
  readonly settings: FilterSettings | null;
  /** What the screen last drew, with its counts; null before it has. */
  readonly filtered: FilteredNewReleases | null;
  /** Takes effect at once everywhere and is written to `kv`; a write that fails reaches the rejection tracker. */
  readonly update: (next: FilterSettings) => void;
};

export function useReleaseFilter(): ReleaseFilterState {
  const { db } = useAppState();
  useEffect(() => loadFor(db), [db]);
  const held = useSyncExternalStore(subscribe, () => snapshot);
  const current = held.db === db ? held : { db, loaded: false, settings: null, filtered: null };
  return {
    loaded: current.loaded,
    settings: current.settings,
    filtered: current.filtered,
    update: (next) => {
      if (snapshot.db !== db) return;
      publish({ ...snapshot, settings: next });
      void writeFilterSettings(db, next);
    },
  };
}

/** The screen hands over what it filtered; the sheet reads it. */
export function publishFiltered(db: SQLiteDatabase, filtered: FilteredNewReleases): void {
  if (snapshot.db === db && snapshot.filtered !== filtered) publish({ ...snapshot, filtered });
}

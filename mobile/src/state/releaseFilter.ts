/**
 * The New releases filter as one store the screen, its button and the Filters sheet share (task 0071, decisions 5 to
 * 9): the settings read once per store from `kv` and written back on every change, and the view the screen last read,
 * so the sheet counts the list's own Releases (decision 21) without reading the store a second time. The sheet is its
 * own route, so the screen publishes its view and the sheet filters it in the same render as the tapped control; the
 * list behind follows as a deferred render (the author's request of 2026-10-14).
 */
import type { SQLiteDatabase } from 'expo-sqlite';
import { useEffect, useSyncExternalStore } from 'react';

import type { NewReleasesView } from '@/domain/newReleases';
import { reportCode } from '@/tally/errors';

import { useAppState } from './appState';
import { readFilterSettings, writeFilterSettings, type FilterSettings } from './filterSettings';

type Snapshot = {
  readonly db: SQLiteDatabase | null;
  readonly loaded: boolean;
  readonly settings: FilterSettings | null;
  readonly view: NewReleasesView | null;
};

let snapshot: Snapshot = { db: null, loaded: false, settings: null, view: null };
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
  publish({ db, loaded: false, settings: null, view: null });
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
  /** False until the saved settings have been read, so a link that sets them waits for what is saved. */
  readonly loaded: boolean;
  readonly settings: FilterSettings | null;
  /** The view New releases last read, unfiltered; null before it has. */
  readonly view: NewReleasesView | null;
  /** Takes effect at once everywhere and is written to `kv`; a write that fails reaches the rejection tracker. */
  readonly update: (next: FilterSettings) => void;
};

export function useReleaseFilter(): ReleaseFilterState {
  const { db } = useAppState();
  useEffect(() => loadFor(db), [db]);
  const held = useSyncExternalStore(subscribe, () => snapshot);
  const current = held.db === db ? held : { db, loaded: false, settings: null, view: null };
  return {
    loaded: current.loaded,
    settings: current.settings,
    view: current.view,
    update: (next) => {
      if (snapshot.db !== db) return;
      publish({ ...snapshot, settings: next });
      void writeFilterSettings(db, next);
    },
  };
}

/** The screen hands over each view it reads; the sheet filters it. */
export function publishView(db: SQLiteDatabase, view: NewReleasesView): void {
  if (snapshot.db === db && snapshot.view !== view) publish({ ...snapshot, view });
}

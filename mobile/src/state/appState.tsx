/**
 * The one context every screen reads: the open store, the Bandcamp session, the
 * gather state and a version that moves whenever the Projection folds, at most every two seconds, so a
 * screen re-reads its query (task 0036). `putRaw` is the only way a response
 * enters the phone: verbatim into raw_documents, then folded (ADR-0004). `removeStore` deletes the store file and
 * opens a fresh one, which remounts everything under the provider.
 */
import { useIsFocused } from 'expo-router';
import { deleteDatabaseAsync, type SQLiteDatabase } from 'expo-sqlite';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { BandcampSession } from '@/bandcamp/session';
import type { BandcampDocument } from '@/bandcamp/wire';
import { EMPTY_GATHER_STATE, type GatherState } from '@/fetcher/sink';
import type { GatherReason } from '@/fetcher/turn';
import { ensureProjectionVersion, fold, insertRawDocument, openStore, STORE_FILE } from '@/store';

import { loadGatherState } from './gatherSink';

export type AppState = {
  readonly db: SQLiteDatabase;
  readonly session: BandcampSession;
  readonly gather: GatherState;
  readonly setGather: (state: GatherState) => void;
  readonly version: number;
  readonly invalidate: () => void;
  readonly putRaw: (doc: BandcampDocument) => Promise<{ deduped: boolean }>;
  readonly runGather: (reason: GatherReason) => Promise<void>;
  readonly removeStore: () => Promise<void>;
};

const AppStateContext = createContext<AppState | null>(null);

/** The fastest the version moves, so a long first walk re-reads each screen every two seconds, not every fold. */
export const INVALIDATE_EVERY_MS = 2_000;
/** A screen out of view follows the version once it has held still this long, or at once when it comes back into view. */
export const UNFOCUSED_SETTLE_MS = 10_000;

type Runner = (reason: GatherReason, app: AppState) => Promise<void>;

export function AppStateProvider({ children, runner }: { children: ReactNode; runner?: Runner }) {
  const [db, setDb] = useState<SQLiteDatabase | null>(null);
  const [gather, setGather] = useState<GatherState>(EMPTY_GATHER_STATE);
  const [version, setVersion] = useState(0);
  const session = useMemo(() => new BandcampSession(), []);
  const self = useRef<AppState | null>(null);
  const [generation, setGeneration] = useState(0);

  useEffect(() => {
    let alive = true;
    void openStore().then(async (store) => {
      await ensureProjectionVersion(store.db).catch((error: unknown) => {
        console.warn('replay after a parser change failed:', error instanceof Error ? error.message : String(error));
      });
      await loadGatherState({ db: store.db, setGather, invalidate: () => undefined }).catch(() => undefined);
      if (alive) setDb(store.db);
    });
    return () => {
      alive = false;
    };
  }, [generation]);

  const lastBump = useRef(0);
  const trailing = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (trailing.current !== null) clearTimeout(trailing.current);
    },
    [],
  );
  // A walk folds every five pages; screens re-read at most once per window, and once more after the last fold.
  const invalidate = useCallback(() => {
    if (trailing.current !== null) return;
    const bump = () => {
      trailing.current = null;
      lastBump.current = Date.now();
      setVersion((v) => v + 1);
    };
    const wait = lastBump.current + INVALIDATE_EVERY_MS - Date.now();
    if (wait <= 0) bump();
    else trailing.current = setTimeout(bump, wait);
  }, []);

  const putRaw = useCallback(
    async (doc: BandcampDocument) => {
      if (!db) throw new Error('store not open');
      const result = await insertRawDocument(db, doc);
      if (!result.deduped) {
        await fold(db);
        invalidate();
      }
      return { deduped: result.deduped };
    },
    [db, invalidate],
  );

  const runGather = useCallback(
    async (reason: GatherReason) => {
      if (runner && self.current) await runner(reason, self.current);
    },
    [runner],
  );

  const removeStore = useCallback(async () => {
    if (!db) return;
    setDb(null);
    await db.closeAsync().catch(() => undefined);
    try {
      await deleteDatabaseAsync(STORE_FILE);
    } catch {
      // The file would not go (a connection still open): empty every table of a fresh open instead.
      const { db: fresh } = await openStore();
      const tables = await fresh.getAllAsync<{ name: string }>(
        "select name from sqlite_master where type = 'table' and name not in ('schema_migrations') and name not like 'sqlite_%'",
      );
      for (const { name } of tables) await fresh.execAsync(`delete from "${name}"`);
      await fresh.closeAsync();
    }
    setGather(EMPTY_GATHER_STATE);
    setGeneration((g) => g + 1);
  }, [db]);

  if (!db) return null;
  const value: AppState = { db, session, gather, setGather, version, invalidate, putRaw, runGather, removeStore };
  self.current = value;
  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>;
}

export function useAppState(): AppState {
  const state = useContext(AppStateContext);
  if (!state) throw new Error('useAppState needs an AppStateProvider above it');
  return state;
}

/** The version a screen reads at: the live one while it is in view, else the live one once it settles or the screen returns. */
function useFollowedVersion(version: number): number {
  const focused = useIsFocused();
  const [followed, setFollowed] = useState(version);
  useEffect(() => {
    if (followed === version) return;
    if (focused) {
      setFollowed(version);
      return;
    }
    const timer = setTimeout(() => setFollowed(version), UNFOCUSED_SETTLE_MS);
    return () => clearTimeout(timer);
  }, [version, focused, followed]);
  return followed;
}

/** Re-runs `read` whenever the Projection folds, and at once when `deps` change; `null` until the first answer. */
export function useLiveQuery<T>(read: (db: SQLiteDatabase) => Promise<T>, deps: readonly unknown[] = []): T | null {
  const { db, version: live } = useAppState();
  const version = useFollowedVersion(live);
  const [value, setValue] = useState<T | null>(null);
  useEffect(() => {
    let alive = true;
    read(db).then(
      (v) => {
        if (alive) setValue(v);
      },
      // A read racing a store being removed has nothing to show; the next version re-reads.
      () => undefined,
    );
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, version, ...deps]);
  return value;
}

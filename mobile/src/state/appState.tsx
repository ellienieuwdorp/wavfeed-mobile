/**
 * The one context every screen reads: the open store, the Bandcamp session, the
 * gather state and a version that moves whenever the Projection folds, so a
 * screen re-reads its query (task 0036). `putRaw` is the only way a response
 * enters the phone: verbatim into raw_documents, then folded (ADR-0004).
 */
import type { SQLiteDatabase } from 'expo-sqlite';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { BandcampSession } from '@/bandcamp/session';
import type { BandcampDocument } from '@/bandcamp/wire';
import { EMPTY_GATHER_STATE, type GatherState } from '@/fetcher/sink';
import type { GatherReason } from '@/fetcher/turn';
import { fold, insertRawDocument, openStore } from '@/store';

export type AppState = {
  readonly db: SQLiteDatabase;
  readonly session: BandcampSession;
  readonly gather: GatherState;
  readonly setGather: (state: GatherState) => void;
  readonly version: number;
  readonly invalidate: () => void;
  readonly putRaw: (doc: BandcampDocument) => Promise<{ deduped: boolean }>;
  readonly runGather: (reason: GatherReason) => Promise<void>;
};

const AppStateContext = createContext<AppState | null>(null);

type Runner = (reason: GatherReason, app: AppState) => Promise<void>;

export function AppStateProvider({ children, runner }: { children: ReactNode; runner?: Runner }) {
  const [db, setDb] = useState<SQLiteDatabase | null>(null);
  const [gather, setGather] = useState<GatherState>(EMPTY_GATHER_STATE);
  const [version, setVersion] = useState(0);
  const session = useMemo(() => new BandcampSession(), []);
  const self = useRef<AppState | null>(null);

  useEffect(() => {
    let alive = true;
    void openStore().then((store) => {
      if (alive) setDb(store.db);
    });
    return () => {
      alive = false;
    };
  }, []);

  const invalidate = useCallback(() => setVersion((v) => v + 1), []);

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

  if (!db) return null;
  const value: AppState = { db, session, gather, setGather, version, invalidate, putRaw, runGather };
  self.current = value;
  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>;
}

export function useAppState(): AppState {
  const state = useContext(AppStateContext);
  if (!state) throw new Error('useAppState needs an AppStateProvider above it');
  return state;
}

/** Re-runs `read` whenever the Projection folds; `null` until the first answer. */
export function useLiveQuery<T>(read: (db: SQLiteDatabase) => Promise<T>, deps: readonly unknown[] = []): T | null {
  const { db, version } = useAppState();
  const [value, setValue] = useState<T | null>(null);
  useEffect(() => {
    let alive = true;
    void read(db).then((v) => {
      if (alive) setValue(v);
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, version, ...deps]);
  return value;
}

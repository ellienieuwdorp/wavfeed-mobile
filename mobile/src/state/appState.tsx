/**
 * The one context every screen reads: the open store, the Bandcamp session, the
 * gather state and a version that moves whenever the Projection folds, at most every two seconds, so a
 * screen re-reads its query (task 0036). `putRaw` is the only way a response
 * enters the phone: verbatim into raw_documents, then folded (ADR-0004); a release page folds without moving the version.
 * `removeStore` deletes the store file and opens a fresh one, which remounts everything under the provider. The gather
 * runner's Tallies go to whatever `track` the sharing provider below binds with `bindTally` (task 0038). A store that
 * will not open shows the failure screen, whose "Try again" opens it once more; the open store is where Error Reports
 * are written, and a failed replay is a coded one (task 0038 decisions 10 and 11).
 */
import { useIsFocused } from 'expo-router';
import { deleteDatabaseAsync, type SQLiteDatabase } from 'expo-sqlite';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { BandcampSession } from '@/bandcamp/session';
import type { BandcampDocument } from '@/bandcamp/wire';
import { CRUMBS_PAGE_ENDPOINT } from '@/bandcamp/wire';
import { StoreFailed } from '@/components/Failed';
import { RELEASE_PAGE_ENDPOINT } from '@/domain/endpoints';
import { EMPTY_GATHER_STATE, type GatherState } from '@/fetcher/sink';
import type { GatherReason } from '@/fetcher/turn';
import { emptyStore, ensureProjectionVersion, fold, insertRawDocument, openStore, STORE_FILE } from '@/store';
import type { Tally } from '@/tally/catalogue';
import { errorReports, reportCode } from '@/tally/errors';

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
  /** The sharing provider's `track`, bound while it is mounted; null unbinds. */
  readonly bindTally: (track: TallyTrack | null) => void;
};

export type TallyTrack = (tally: Tally) => void;

const AppStateContext = createContext<AppState | null>(null);

/** The fastest the version moves, so a long first walk re-reads each screen every two seconds, not every fold. */
export const INVALIDATE_EVERY_MS = 2_000;
/** A screen out of view follows the version once it has held still this long, or at once when it comes back into view. */
export const UNFOCUSED_SETTLE_MS = 10_000;

/** What a gather turn needs from the app state: the store, the session, the two ways it reports back and its Tallies. */
export type RunnerDeps = Pick<AppState, 'db' | 'session' | 'setGather' | 'invalidate'> & { readonly track: TallyTrack };

type Runner = (reason: GatherReason, app: RunnerDeps) => Promise<void>;

export function AppStateProvider({ children, runner }: { children: ReactNode; runner?: Runner }) {
  const [db, setDb] = useState<SQLiteDatabase | null>(null);
  const [gather, setGather] = useState<GatherState>(EMPTY_GATHER_STATE);
  const [version, setVersion] = useState(0);
  const session = useMemo(() => new BandcampSession(), []);
  const [generation, setGeneration] = useState(0);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    void openStore().then(
      async (store) => {
        errorReports.setSink(store.db);
        await ensureProjectionVersion(store.db).catch((error: unknown) => {
          console.warn('replay after a parser change failed:', error instanceof Error ? error.message : String(error));
          reportCode('projection_replay_failed', error);
        });
        await loadGatherState({ db: store.db, setGather, invalidate: () => undefined }).catch(() => undefined);
        if (alive) setDb(store.db);
      },
      () => alive && setFailed(true),
    );
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
        // A page fetched to play or to name a wishlist Page only enriches its Release's date, preorder flag and track count,
        // which the next fold's version move shows; moving it here re-read every mounted screen as the player opened (task 0036).
        if (doc.endpoint !== RELEASE_PAGE_ENDPOINT && doc.endpoint !== CRUMBS_PAGE_ENDPOINT) invalidate();
      }
      return { deduped: result.deduped };
    },
    [db, invalidate],
  );

  const tallyTo = useRef<TallyTrack | null>(null);
  const bindTally = useCallback((track: TallyTrack | null) => {
    tallyTo.current = track;
  }, []);
  const track = useCallback((tally: Tally) => tallyTo.current?.(tally), []);

  const runGather = useCallback(
    async (reason: GatherReason) => {
      if (runner && db) await runner(reason, { db, session, setGather, invalidate, track });
    },
    [runner, db, session, invalidate, track],
  );

  const removeStore = useCallback(async () => {
    if (!db) return;
    setDb(null);
    errorReports.setSink(null);
    await db.closeAsync().catch(() => undefined);
    try {
      await deleteDatabaseAsync(STORE_FILE);
    } catch {
      // The file would not go (a connection still open): empty every table of a fresh open instead.
      const { db: fresh } = await openStore();
      await emptyStore(fresh);
      await fresh.closeAsync();
    }
    setGather(EMPTY_GATHER_STATE);
    setGeneration((g) => g + 1);
  }, [db]);

  if (failed) {
    return (
      <StoreFailed
        onRetry={() => {
          setFailed(false);
          setGeneration((g) => g + 1);
        }}
      />
    );
  }
  if (!db) return null;
  const value: AppState = { db, session, gather, setGather, version, invalidate, putRaw, runGather, removeStore, bindTally };
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
  // In view it follows at once, set during render so the screen never paints the old version first.
  if (focused && followed !== version) setFollowed(version);
  useEffect(() => {
    if (focused || followed === version) return;
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

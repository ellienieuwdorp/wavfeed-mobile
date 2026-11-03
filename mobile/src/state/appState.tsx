/**
 * The one context every screen reads: the open store, the Bandcamp session, the gather state and a version that moves
 * at most every two seconds when the Projection folds, so a screen re-reads its query. `putRaw` is the only way a
 * response enters the phone: verbatim into raw_documents, then folded (ADR-0004). `removeStore` deletes the store
 * file and opens a fresh one, remounting everything below. A store that will not open shows the failure screen with
 * "Try again" and "Start over" (REL-4); a long replay shows its progress in place of the app (ARCH-1). A screen's
 * query that throws is reported and rethrown while drawing, for the tab's boundary (ARCH-2).
 */
import { useIsFocused } from 'expo-router';
import type { SQLiteDatabase } from 'expo-sqlite';
import { createContext, useCallback, useContext, useEffect, useEffectEvent, useMemo, useRef, useState, type ReactNode } from 'react';

import { BandcampSession } from '@/bandcamp/session';
import type { BandcampDocument } from '@/bandcamp/wire';
import { CRUMBS_PAGE_ENDPOINT } from '@/bandcamp/wire';
import { StoreFailed } from '@/components/Failed';
import { Replaying } from '@/components/Replaying';
import { EMPTY_GATHER_STATE, type GatherState } from '@/fetcher/sink';
import type { GatherReason } from '@/fetcher/turn';
import { deleteStoreFile, emptyStore, openStore } from '@/store/schema';
import { fold } from '@/store/projection';
import { insertRawDocument } from '@/store/rawDocuments';
import type { Tally } from '@/tally/catalogue';
import { errorReports, reportCode } from '@/tally/errors';
import { retireWishlist } from '@/wishlist/membership';

import { loadGatherState, replayAtLaunch } from './gatherSink';

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

/** Stores "Remove everything gathered" has closed, whose reads still racing it fail with nothing to report (ARCH-2). */
const removed = new WeakSet<SQLiteDatabase>();

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
  const [failed, setFailed] = useState<{ readonly error: unknown } | null>(null);
  const [replaying, setReplaying] = useState<{ done: number; total: number } | null>(null);

  useEffect(() => {
    let alive = true;
    void openStore().then(
      async (store) => {
        errorReports.setSink(store.db);
        const deps = { db: store.db, setGather, invalidate: () => undefined };
        await replayAtLaunch(deps, (done, total) => alive && setReplaying({ done, total }));
        await loadGatherState(deps).catch(() => undefined);
        if (!alive) return;
        setReplaying(null);
        setDb(store.db);
      },
      (error: unknown) => alive && setFailed({ error }),
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
        // Preview pages change visible facts; the shared throttle coalesces their reads. Crumb extracts project no facts.
        if (doc.endpoint !== CRUMBS_PAGE_ENDPOINT) invalidate();
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
    await retireWishlist(db);
    removed.add(db);
    setDb(null);
    errorReports.setSink(null);
    await db.closeAsync().catch(() => undefined);
    try {
      await deleteStoreFile();
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
    const reopen = () => {
      setFailed(null);
      setGeneration((g) => g + 1);
    };
    // A store that fails the same way on every open is deleted and opened empty (review REL-4).
    const startOver = async () => {
      await deleteStoreFile();
      reopen();
    };
    return <StoreFailed error={failed.error} onRetry={reopen} onStartOver={startOver} />;
  }
  if (!db) return replaying === null ? null : <Replaying done={replaying.done} total={replaying.total} />;
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

type Live<T> =
  | { readonly status: 'loading' }
  | { readonly status: 'ok'; readonly value: T }
  | { readonly status: 'error'; readonly error: unknown };

/**
 * Re-runs `read` whenever the Projection folds and at once when `key` changes; `null` until the first answer. A
 * rejection from a removed store is dropped; any other is reported as `query_failed`, wrapped if not an object, and
 * thrown while drawing unless a newer read replaced it, for the tab's boundary (ARCH-2). `key` is one value so the
 * effect's dependencies stay static for the React Compiler (TECH-12).
 */
export function useLiveQuery<T>(read: (db: SQLiteDatabase) => Promise<T>, key: string | number | null = null): T | null {
  const { db, version: live } = useAppState();
  const version = useFollowedVersion(live);
  const [answer, setAnswer] = useState<Live<T>>({ status: 'loading' });
  const readNow = useEffectEvent(read);
  useEffect(() => {
    let alive = true;
    readNow(db).then(
      (value) => {
        if (alive) setAnswer({ status: 'ok', value });
      },
      (thrown: unknown) => {
        if (removed.has(db)) return;
        const error = typeof thrown === 'object' && thrown !== null ? thrown : new Error(String(thrown));
        reportCode('query_failed', error);
        if (alive) setAnswer({ status: 'error', error });
      },
    );
    return () => {
      alive = false;
    };
  }, [db, version, key]);
  if (answer.status === 'error') throw answer.error;
  return answer.status === 'ok' ? answer.value : null;
}

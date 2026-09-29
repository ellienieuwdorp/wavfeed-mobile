/**
 * The sharing switch and its sender inside the app state (task 0038, ADR-0021). It reads the yes from `kv`, mints the
 * Install id with `expo-crypto` at each yes and drops it at each off, and while the gate is open runs one `Sender`:
 * a flush once `app_opened` is queued at launch, at each foreground and background, every minute while active and at
 * 20 queued rows. It folds AppState into `app_opened` and the foreground marker (`lifecycle.ts`). A build the gate can
 * never open (`sendEnv` null: a development bundle without the override, Expo Go, no URL or key) reads nothing and
 * writes nothing, and every write is also guarded in SQL by the stored yes. `removeStore` remounts it with the store.
 * `track` is the one way a Tally is queued; the gather runner above it reaches it through the app state's `bindTally`.
 */
import * as Application from 'expo-application';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import { randomUUID } from 'expo-crypto';
import * as Updates from 'expo-updates';
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppState, Platform } from 'react-native';

import type { FeedbackFacts } from '@/copy';
import { useAppState } from '@/state/appState';
import { readStoredIdentity } from '@/state/gatherSink';

import type { Tally } from './catalogue';
import { clearForegroundMarker, lifeStep, NEW_LIFE, setForegroundMarker, takeEndedUnexpectedly, type Life } from './lifecycle';
import { enqueueTally, readSharing, turnSharingOff, turnSharingOn } from './outbox';
import { fetchPost, FLUSH_EVERY_MS, REMOVE_FLUSH_MS, Sender } from './send';
import { buildContext, sendEnv, sharingCode, type AppFacts, type BuildFacts, type Sharing } from './tally';

// Each `process.env.EXPO_PUBLIC_*` is spelled out so Metro inlines it.
const BUILD: BuildFacts = {
  dev: __DEV__,
  devOverride: process.env.EXPO_PUBLIC_TALLY_DEV === '1',
  expoGo: Constants.executionEnvironment === ExecutionEnvironment.StoreClient,
  url: process.env.EXPO_PUBLIC_TALLY_URL,
  key: process.env.EXPO_PUBLIC_TALLY_KEY,
  appEnv: process.env.EXPO_PUBLIC_APP_ENV,
};
const ENV = sendEnv(BUILD);

const APP: AppFacts = {
  version: Application.nativeApplicationVersion,
  build: Application.nativeBuildVersion,
  embedded: Updates.isEmbeddedLaunch,
  updateId: Updates.updateId,
  platform: Platform.OS === 'ios' ? 'ios' : 'android',
  osVersion: Platform.Version,
};
const CTX = ENV === null ? null : buildContext(APP, ENV);

/** The version, build and OS a feedback mail names; Android's OS is its release, not the API level the ctx carries. */
export function feedbackFacts(code: string | null): FeedbackFacts {
  const release = Platform.OS === 'android' ? String(Platform.constants.Release) : String(Platform.Version);
  const os = `${Platform.OS === 'ios' ? 'iOS' : 'Android'} ${Number.parseInt(release, 10) || release}`;
  return { version: APP.version ?? '?', build: APP.build ?? '?', os, code };
}

/** The process's AppState history, kept across a removed store's remount. */
let life: Life = NEW_LIFE;

export type SharingApi = {
  /** False when this build can never send: the ask and the Usage group stay hidden. */
  readonly canSend: boolean;
  /** False until the stored answer has been read. */
  readonly loaded: boolean;
  readonly sharing: Sharing | null;
  readonly code: string | null;
  readonly turnOn: () => Promise<void>;
  /** Returns the dropped code, for the tester to quote in an erasure request. */
  readonly turnOff: () => Promise<string | null>;
  /** Queues a Tally when sharing is on; never throws and never waits in a press. */
  readonly track: (tally: Tally) => void;
  /** Queues a Tally and waits at most `REMOVE_FLUSH_MS` for it to go, for "Remove everything gathered". */
  readonly trackAndFlush: (tally: Tally) => Promise<void>;
};

const SharingContext = createContext<SharingApi | null>(null);

export function SharingProvider({ children }: { children: ReactNode }) {
  const app = useAppState();
  const { db } = app;
  const gather = useRef(app.gather);
  const [sharing, setSharing] = useState<Sharing | null>(null);
  const [loaded, setLoaded] = useState(ENV === null);
  const sender = useRef<Sender | null>(null);
  const chain = useRef<Promise<void>>(Promise.resolve());
  const install = ENV !== null && sharing !== null ? sharing.install : null;
  // Set with the state it mirrors, not after the render, since child effects such as the screen Tally run first.
  const held = useRef<string | null>(null);
  useEffect(() => {
    gather.current = app.gather;
  });

  const enqueue = useCallback(
    async (tally: Tally): Promise<void> => {
      if (held.current === null) return;
      const t = Date.now();
      const { identity, initialWalkDone } = gather.current;
      const signedIn = identity !== null || (await readStoredIdentity(db)) !== null;
      if (await enqueueTally(db, tally, { t, signedIn, walkDone: initialWalkDone })) await sender.current?.queued();
    },
    [db],
  );

  // One chain for every write, the yes and the off included, so each runs in the order it was asked for.
  const later = useCallback(<T,>(work: () => Promise<T>): Promise<T> => {
    const next = chain.current.then(work);
    chain.current = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }, []);

  const track = useCallback((tally: Tally) => void later(() => enqueue(tally)).catch(() => undefined), [later, enqueue]);

  // The answer is read on the chain, queued in a layout effect ahead of every child's effect, so a Tally tracked before
  // it lands waits for it and is not dropped.
  useLayoutEffect(() => {
    if (ENV === null) return;
    let alive = true;
    later(async () => {
      const answer = await readSharing(db);
      if (alive) held.current = answer?.install ?? null;
      return answer;
    })
      .then((answer) => alive && setSharing(answer))
      .catch(() => undefined)
      .finally(() => alive && setLoaded(true));
    return () => {
      alive = false;
    };
  }, [db, later]);

  // The gather runner sits above this provider, in the app state, and reaches `track` through the binding.
  const { bindTally } = app;
  useLayoutEffect(() => {
    bindTally(track);
    return () => bindTally(null);
  }, [bindTally, track]);

  // The switch shows what the store holds once each yes or off has run, whatever order two quick presses land in.
  const settleSharing = useCallback(async (): Promise<void> => {
    const answer = await readSharing(db);
    held.current = answer?.install ?? null;
    setSharing(answer);
  }, [db]);

  useEffect(() => {
    if (install === null || CTX === null || !BUILD.url || !BUILD.key) return;
    const current = new Sender({
      db,
      url: BUILD.url,
      key: BUILD.key,
      install,
      ctx: CTX,
      post: fetchPost(fetch),
      now: Date.now,
      newId: randomUUID,
      at: () => ({ t: Date.now(), signedIn: gather.current.identity !== null, walkDone: gather.current.initialWalkDone }),
      random: Math.random,
      setTimer: (run, ms) => setTimeout(run, ms),
      clearTimer: (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>),
    });
    sender.current = current;
    return () => {
      current.dispose();
      if (sender.current === current) sender.current = null;
    };
  }, [db, install]);

  // Runs at mount and whenever the gate opens or closes, so a yes mid-session is that Install's cold open. A layout
  // effect runs before any child's effect, so `app_opened` queues ahead of the first `screen_viewed`.
  useLayoutEffect(() => {
    const apply = (phase: string): void => {
      const step = lifeStep(life, phase, held.current);
      life = step.life;
      later(async () => {
        if (step.checkEnded && (await takeEndedUnexpectedly(db))) await enqueue({ name: 'app_ended_unexpectedly', props: {} });
        if (step.launch !== null) await enqueue({ name: 'app_opened', props: { launch: step.launch } });
        if (step.marker === 'set') await setForegroundMarker(db, Date.now());
        if (step.marker === 'clear') await clearForegroundMarker(db);
      }).then(
        () => {
          if (phase === 'active' || phase === 'background') sender.current?.request();
        },
        () => undefined,
      );
    };
    apply(AppState.currentState);
    const subscription = AppState.addEventListener('change', apply);
    const tick = setInterval(() => {
      if (AppState.currentState === 'active') sender.current?.request();
    }, FLUSH_EVERY_MS);
    return () => {
      subscription.remove();
      clearInterval(tick);
    };
  }, [db, install, enqueue, later]);

  const turnOn = useCallback(async () => {
    if (ENV === null) return;
    await later(async () => {
      await turnSharingOn(db, randomUUID(), Date.now());
      await settleSharing();
    });
  }, [db, later, settleSharing]);

  // Nothing more is queued or sent from the press on; the store's rows go in the chained write.
  const turnOff = useCallback(async () => {
    held.current = null;
    sender.current?.dispose();
    return later(async () => {
      const dropped = await turnSharingOff(db).finally(settleSharing);
      return dropped === null ? null : sharingCode(dropped.install);
    });
  }, [db, later, settleSharing]);

  const trackAndFlush = useCallback(
    async (tally: Tally) => {
      const work = later(() => enqueue(tally)).then(() => sender.current?.settle(REMOVE_FLUSH_MS));
      let timer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([work.catch(() => undefined), new Promise<void>((done) => (timer = setTimeout(done, REMOVE_FLUSH_MS)))]);
      clearTimeout(timer);
    },
    [enqueue, later],
  );

  const value = useMemo<SharingApi>(
    () => ({
      canSend: ENV !== null,
      loaded,
      sharing: install === null ? null : sharing,
      code: install === null ? null : sharingCode(install),
      turnOn,
      turnOff,
      track,
      trackAndFlush,
    }),
    [loaded, install, sharing, turnOn, turnOff, track, trackAndFlush],
  );
  return <SharingContext.Provider value={value}>{children}</SharingContext.Provider>;
}

export function useSharing(): SharingApi {
  const api = useContext(SharingContext);
  if (!api) throw new Error('useSharing needs a SharingProvider above it');
  return api;
}

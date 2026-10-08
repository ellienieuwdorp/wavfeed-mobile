/**
 * The store build banner (task 0064, docs/design/2026-10-08-update-banner): a card under each view's header when only
 * TestFlight or Google Play can bring this install up to date. It draws from the last `store-builds.json` answer kept
 * in `kv`, recomputed with `verdictOf` at mount, so it arrives with the rows; a fresh answer that differs waits for the
 * next launch or return to the app, except an install's first, which animates in at once. One read per launch and per
 * return after six hours, shared by every banner through a module store. It hides on the collection tabs until a newer
 * build is named; Settings keeps it. A store build's card opens TestFlight or Play; a website APK's downloads and
 * installs the next APK (task 0065, decision 6), or opens the download where the binary cannot install. Only builds
 * with updates enabled and a channel `distributionOf` knows check; a development bundle has neither.
 */
import * as Application from 'expo-application';
import { openURL } from 'expo-linking';
import * as Updates from 'expo-updates';
import type { SQLiteDatabase } from 'expo-sqlite';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { AppState, LayoutAnimation, Platform, Pressable, View } from 'react-native';

import { copy } from '@/copy';
import { canInstall, downloadAndInstall } from '@/lib/apkInstall';
import { distributionOf, newerBuild, readStoreBuilds, STORE_URLS, type Installed, type NewerBuild } from '@/lib/storeBuild';
import { useReduceMotion } from '@/player/motion';
import { useAppState } from '@/state/appState';
import { readKv, writeKv } from '@/store/kv';
import { pressedOpacity, ripple, type, useTokens } from '@/theme/tokens';

import { Glyph } from './Glyph';
import { Type } from './Type';

const ios = Platform.OS === 'ios';
const ANSWER_KEY = 'store_builds_answer';
const HIDDEN_KEY = 'store_build_hidden';
const RECHECK_MS = 6 * 60 * 60 * 1000;

const INSTALLED: Installed = {
  platform: ios ? 'ios' : 'android',
  build: Application.nativeBuildVersion,
  runtime: Updates.runtimeVersion ?? null,
  channel: Updates.channel ?? null,
};
const ENABLED = Updates.isEnabled && distributionOf(INSTALLED) !== null;

type Shown = { readonly answer: unknown; readonly hidden: number | null };

let shown: Shown | null = null;
let pending: unknown = null;
let started = false;
let checkedAt = 0;
let animate = true;
/** The store the hook last handed over: "Remove everything gathered" opens a new one under the same banners. */
let latestDb: SQLiteDatabase | null = null;
const listeners = new Set<() => void>();

function set(next: Shown, animated: boolean): void {
  if (animated && animate) LayoutAnimation.configureNext(LayoutAnimation.create(200, 'easeInEaseOut', 'opacity'));
  shown = next;
  for (const listener of listeners) listener();
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

async function check(db: () => SQLiteDatabase, first: boolean): Promise<void> {
  checkedAt = Date.now();
  const fresh = await readStoreBuilds();
  if (fresh === null) return;
  await writeKv(db(), ANSWER_KEY, fresh).catch(() => undefined);
  if (first) set({ answer: fresh, hidden: shown?.hidden ?? null }, true);
  else pending = same(fresh, shown?.answer) ? null : fresh;
}

/** The first banner to mount reads the kept answer, checks, and listens for the app's return. */
async function start(db: () => SQLiteDatabase): Promise<void> {
  started = true;
  const [answer, hidden] = await Promise.all([readKv<unknown>(db(), ANSWER_KEY), readKv<number>(db(), HIDDEN_KEY)]).catch(() => [null, null] as const);
  set({ answer, hidden }, false);
  AppState.addEventListener('change', (next) => {
    if (next !== 'active') return;
    if (pending !== null && shown !== null) set({ ...shown, answer: pending }, true);
    pending = null;
    if (Date.now() - checkedAt > RECHECK_MS) void check(db, false);
  });
  await check(db, answer === null);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const read = () => shown;

/** `hideable` is false in Settings, where a hidden banner shows again. */
export function UpdateBanner({ hideable }: { hideable: boolean }) {
  const { db } = useAppState();
  const reduceMotion = useReduceMotion();
  const state = useSyncExternalStore(subscribe, read);
  useEffect(() => {
    animate = !reduceMotion;
  }, [reduceMotion]);
  useEffect(() => {
    latestDb = db;
    if (ENABLED && !started) void start(() => latestDb ?? db);
  }, [db]);
  const newer = state === null ? null : newerBuild(state.answer, INSTALLED);
  if (newer === null || (hideable && state !== null && state.hidden !== null && state.hidden >= newer.build)) return null;
  return <Card newer={newer} hideable={hideable} db={db} />;
}

/** What the card's line says after a press: nothing yet, a store that would not open, or how the APK install went. */
type Outcome = null | 'openFailed' | 'confirm' | 'damaged' | 'downloadFailed' | { readonly downloading: number };

function Card({ newer, hideable, db }: { newer: NewerBuild; hideable: boolean; db: SQLiteDatabase }) {
  const { c } = useTokens();
  const [outcome, setOutcome] = useState<Outcome>(null);
  const u = copy.update;
  const { build } = newer;
  const mine = Number(INSTALLED.build);
  const apk = newer.distribution === 'apk';
  const installs = apk && canInstall();
  const title = apk ? u.apkTitle : u.title;
  const said = apk ? u.apkLine(mine, build) : u.line(mine, build);
  const line = outcome === null ? said : typeof outcome === 'object' ? u.downloading(Math.round(outcome.downloading * 100)) : u[outcome];
  const action = !apk ? u.open : installs ? u.install(build) : u.download(build);
  const hint = !apk ? u.openHint : installs ? u.installHint : u.downloadHint;
  const busy = typeof outcome === 'object' && outcome !== null;
  const install = async () => {
    if (busy || !newer.url || !newer.md5) return;
    setOutcome({ downloading: 0 });
    const result = await downloadAndInstall(newer.url, newer.md5, build, (share) => setOutcome({ downloading: share }));
    setOutcome(result === 'installing' ? 'confirm' : result === 'damaged' ? 'damaged' : 'downloadFailed');
  };
  const open = async () => {
    if (installs) return install();
    for (const url of apk && newer.url ? [newer.url] : STORE_URLS[INSTALLED.platform]) {
      try {
        await openURL(url);
        setOutcome(null);
        return;
      } catch {
        // The next address, then the failed line.
      }
    }
    setOutcome('openFailed');
  };
  const hide = () => {
    if (shown !== null) set({ ...shown, hidden: build }, true);
    void writeKv(db, HIDDEN_KEY, build).catch(() => undefined);
  };
  return (
    <View style={{ marginHorizontal: type.gutter, marginBottom: 16, borderRadius: ios ? 14 : 16, borderCurve: 'continuous', overflow: 'hidden', backgroundColor: c.surface, flexDirection: 'row' }}>
      <Pressable
        onPress={() => void open()}
        android_ripple={ripple(c.track)}
        accessibilityRole="button"
        accessibilityLabel={`${title}. ${line}`}
        accessibilityHint={hint}
        accessibilityState={{ busy }}
        style={({ pressed }) => ({ flex: 1, gap: 4, paddingVertical: 12, paddingLeft: 14, paddingRight: hideable ? 0 : 14, opacity: pressedOpacity(pressed) })}
      >
        <Type style={{ fontSize: ios ? 15 : 16, fontWeight: ios ? '600' : '500', color: c.ink }}>{title}</Type>
        <Type style={{ fontSize: ios ? 13 : 14, lineHeight: ios ? 18 : 20, color: c.sub }}>{line}</Type>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <Type style={{ fontSize: ios ? 15 : 14, fontWeight: ios ? '600' : '500', color: c.accentText }}>{action}</Type>
          {installs ? null : <Glyph name="external" size={ios ? 13 : 16} weight="regular" colour={c.accentText} />}
        </View>
      </Pressable>
      {hideable ? (
        <Pressable
          onPress={hide}
          android_ripple={ripple(c.track, 24)}
          accessibilityRole="button"
          accessibilityLabel={u.hide}
          hitSlop={4}
          style={({ pressed }) => ({ width: ios ? 44 : 48, height: ios ? 44 : 48, alignItems: 'center', justifyContent: 'center', opacity: pressedOpacity(pressed) })}
        >
          <Glyph name="dismiss" size={ios ? 14 : 24} colour={ios ? c.faint : c.sub} />
        </Pressable>
      ) : null}
    </View>
  );
}

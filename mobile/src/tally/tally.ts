/**
 * The pure rules behind every Tally (task 0038, ADR-0021): the count and duration buckets that keep exact numbers off
 * the wire, the closed screen list, the per-batch context built from injected build facts, the sharing gate, the
 * gather diff that turns a chain's before and after `GatherState` into `sync_run_finished` and `gather_finished`, and
 * a fold's skipped counts as `projection_skipped`. Nothing here reads a clock, a random source or the platform itself.
 */
import type { SkippedCounts } from '@/domain/types';
import type { GatherState, WalkState } from '@/fetcher/sink';
import type { GatherReason, TurnSummary } from '@/fetcher/turn';

import {
  SCHEMA,
  WIRE,
  type CountBucket,
  type DurationBucket,
  type Env,
  type Screen,
  type Tally,
  type TallyPlatform,
} from './catalogue';
import type { TallyContext } from './wire';

/** A value that is not a number falls in the lowest bucket, never the highest. */
export function countBucket(n: number): CountBucket {
  if (!(n > 0)) return '0';
  if (n === 1) return '1';
  if (n <= 5) return '2 to 5';
  if (n <= 20) return '6 to 20';
  if (n <= 100) return '21 to 100';
  return '100+';
}

const SECOND = 1_000;
const MINUTE = 60 * SECOND;

/** Each bucket holds its lower edge: 1,000 ms is `1 to 3s`, 60,000 ms is `1 to 10m`. */
export function durationBucket(ms: number): DurationBucket {
  if (!(ms >= SECOND)) return '<1s';
  if (ms < 3 * SECOND) return '1 to 3s';
  if (ms < 10 * SECOND) return '3 to 10s';
  if (ms < MINUTE) return '10 to 60s';
  if (ms < 10 * MINUTE) return '1 to 10m';
  return '10m+';
}

export function crumbReplaysBucket(n: number): '0' | '1' | '2+' {
  return !(n > 0) ? '0' : n === 1 ? '1' : '2+';
}

/** Every route in `src/app`, by the pathname expo-router reports with groups and `index` dropped. */
const SCREEN_PATHS: Readonly<Record<string, Screen>> = {
  '/': 'feed',
  '/releases': 'releases',
  '/releases/upcoming': 'releases_upcoming',
  '/bought': 'bought',
  '/bought/upcoming': 'bought_upcoming',
  '/settings': 'settings',
  '/player': 'player',
  '/connect': 'connect',
  '/bought-by': 'bought_by',
  // The ask shows only while sharing is off and holds the same switch as the Settings group, so it counts as settings.
  '/usage': 'settings',
};

/** Route params and query strings never reach a Tally: only the path's template is looked up. */
export function screenFor(pathname: string): Screen {
  const path = pathname.split(/[?#]/)[0] ?? '';
  const trimmed = path.length > 1 ? path.replace(/\/+$/, '') : path;
  return SCREEN_PATHS[trimmed] ?? 'other';
}

/** A route file's screen, `./(tabs)/releases/upcoming.tsx` read as the pathname `/releases/upcoming` it serves. */
export function screenForRoute(file: string): Screen {
  const parts = file.replace(/^\.?\//, '').replace(/(\.(ios|android))?\.[jt]sx?$/, '').split('/');
  return screenFor(`/${parts.filter((part) => part !== 'index' && !/^\(.*\)$/.test(part)).join('/')}`);
}

/** The Install's handle shown in Settings and quoted for erasure: the Install id's first six characters. */
export function sharingCode(install: string): string {
  return install.slice(0, 6);
}

export type BuildFacts = {
  /** `__DEV__`. */
  readonly dev: boolean;
  /** `EXPO_PUBLIC_TALLY_DEV === '1'`. */
  readonly devOverride: boolean;
  /** `Constants.executionEnvironment === ExecutionEnvironment.StoreClient`. */
  readonly expoGo: boolean;
  /** `EXPO_PUBLIC_TALLY_URL`, `EXPO_PUBLIC_TALLY_KEY` and `EXPO_PUBLIC_APP_ENV`, set only in the EAS environments. */
  readonly url: string | undefined;
  readonly key: string | undefined;
  readonly appEnv: string | undefined;
};

/** Localhost, the Android emulator's host, the tailnet's 100.64.0.0/10 and `*.ts.net`: where `wrangler dev` runs. */
export function isLocalTallyUrl(url: string): boolean {
  let host: string;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
    host = parsed.hostname;
  } catch {
    return false;
  }
  if (host === 'localhost' || host === '127.0.0.1' || host === '10.0.2.2' || host.endsWith('.ts.net')) return true;
  const tailnet = /^100\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/.exec(host);
  return tailnet !== null && Number(tailnet[1]) >= 64 && Number(tailnet[1]) <= 127;
}

/**
 * The environment this build sends under, or null when it can never send: a development bundle only with the
 * override and only to a local Worker, a release build only outside Expo Go, only to a remote Worker and only as
 * preview or production. The ask and the Settings group show only when this is not null.
 */
export function sendEnv(build: BuildFacts): Env | null {
  if (!build.url || !build.key) return null;
  const local = isLocalTallyUrl(build.url);
  if (build.dev) return build.devOverride && local ? 'development' : null;
  if (build.expoGo || local) return null;
  return build.appEnv === 'preview' || build.appEnv === 'production' ? build.appEnv : null;
}

/** The Fan's stored yes and the Install id minted with it; no row means no (see `readSharing`). */
export type Sharing = { readonly on: true; readonly install: string; readonly since: number };

export function gateOpen(build: BuildFacts, sharing: Sharing | null): boolean {
  return sharing?.on === true && sendEnv(build) !== null;
}

export type AppFacts = {
  /** `expo-application` `nativeApplicationVersion` and `nativeBuildVersion`. */
  readonly version: string | null;
  readonly build: string | null;
  /** `expo-updates`: `isEmbeddedLaunch` and `updateId`. */
  readonly embedded: boolean;
  readonly updateId: string | null;
  readonly platform: TallyPlatform;
  /** `Platform.Version`: "26.0" on iOS, the API level on Android. */
  readonly osVersion: string | number;
};

function buildText(value: string | null): string {
  return (value ?? '').replace(/[^0-9A-Za-z.]/g, '').slice(0, 20) || 'unknown';
}

/** The batch's `ctx`, shaped so the Worker's patterns always pass. */
export function buildContext(app: AppFacts, env: Env): TallyContext {
  const major = Number.parseInt(String(app.osVersion), 10);
  return {
    schema: SCHEMA,
    version: buildText(app.version),
    build: buildText(app.build),
    update: !app.embedded && app.updateId !== null && WIRE.uuidPattern.test(app.updateId) ? app.updateId : 'embedded',
    env,
    platform: app.platform,
    os: Math.min(WIRE.osMax, Math.max(WIRE.osMin, Number.isFinite(major) ? major : WIRE.osMin)),
  };
}

/** What `runChain` knows of a chain beyond the gather state: its turns, its clock, the store's counts and the breaker. */
export type ChainFacts = {
  readonly reason: GatherReason;
  readonly last: TurnSummary;
  readonly turns: number;
  readonly retries: number;
  readonly startedAt: number;
  readonly endedAt: number;
  /** The walk held when the chain started, whose `startedAt` is the Sync Run's start when it resumes one. */
  readonly walkAtStart: WalkState | null;
  /** Feed pages the store holds, which after a first walk are the pages it took. */
  readonly feedPages: number;
  readonly releasePagesFailed: number;
  readonly sweepBreakerOpened: boolean;
};

function statusClass(status: number | null): '4xx' | '5xx' | 'none' {
  if (status !== null && status >= 400 && status < 500) return '4xx';
  if (status !== null && status >= 500 && status < 600) return '5xx';
  return 'none';
}

/** `gather_finished` for every chain, preceded by `sync_run_finished` when the chain finished the first walk. */
export function gatherTallies(before: GatherState, after: GatherState, chain: ChainFacts): Tally[] {
  const tallies: Tally[] = [];
  if (!before.initialWalkDone && after.initialWalkDone) {
    const walk = chain.walkAtStart;
    tallies.push({
      name: 'sync_run_finished',
      props: {
        pages: countBucket(chain.feedPages),
        stories: countBucket(after.storiesSoFar),
        took: durationBucket(chain.endedAt - (walk?.startedAt ?? chain.startedAt)),
      },
    });
  }
  tallies.push({
    name: 'gather_finished',
    props: {
      reason: chain.reason,
      outcome: chain.last.outcome,
      turns: countBucket(chain.turns),
      retries: countBucket(chain.retries),
      walk_pending: chain.last.walkPending,
      failure: after.lastError ?? 'none',
      paused: after.pausedReason ?? 'none',
      status_class: statusClass(after.lastError === null ? null : after.lastStatus),
      took: durationBucket(chain.endedAt - chain.startedAt),
      release_pages_failed: countBucket(chain.releasePagesFailed),
      sweep_breaker_opened: chain.sweepBreakerOpened,
    },
  });
  return tallies;
}

/** A fold's skipped counts as `projection_skipped`, or null when it skipped nothing. */
export function projectionSkipped(skipped: SkippedCounts): Tally | null {
  if (skipped.unparsable + skipped.unknownStoryType + skipped.missingFanInfo <= 0) return null;
  return {
    name: 'projection_skipped',
    props: {
      unparsable: countBucket(skipped.unparsable),
      unknown_story_type: countBucket(skipped.unknownStoryType),
      missing_fan_info: countBucket(skipped.missingFanInfo),
    },
  };
}

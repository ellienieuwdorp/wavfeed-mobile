/**
 * The pure rules behind every Tally (ADR-0021): the count and duration buckets that keep exact numbers off
 * the wire, the closed screen list, the per-batch context built from injected build facts, the sharing gate, the
 * gather diff that turns a chain's before and after `GatherState` into `sync_run_finished` and `gather_finished`, and
 * a fold's skipped counts as `projection_skipped`. Nothing here reads a clock, a random source or the platform itself.
 */
import { isDemoFan } from '@/demo/fan';
import type { SkippedCounts } from '@/domain/types';
import type { GatherState, WalkState } from '@/fetcher/sink';
import type { GatherReason, TurnSummary } from '@/fetcher/turn';
import { MINUTE_MS as MINUTE, SECOND_MS as SECOND } from '@/lib/time';

import {
  SCHEMA,
  WIRE,
  type CountBucket,
  type DurationBucket,
  type Env,
  type Screen,
  type Tally,
  type TallyPlatform,
  type TallyProps,
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
  '/settings': 'settings',
  '/player': 'player',
  '/connect': 'connect',
  // The first screen is Connect's first door, so both count as one screen.
  '/welcome': 'connect',
  '/bought-by': 'bought_by',
  // The ask shows only while sharing is off and holds the same switch as the Settings group, so it counts as settings.
  '/usage': 'settings',
  // New releases' Filters sheet belongs to New releases and is not counted.
  '/filters': 'releases',
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

/** The URL names the ingest route itself; a bare host would answer 404, which the sender drops as refused. */
function isIngestEndpoint(url: string): boolean {
  try {
    return new URL(url).pathname === '/v1/batch';
  } catch {
    return false;
  }
}

/**
 * The environment this build sends under, or null when it can never send: a development bundle only with the
 * override and only to a local Worker, a release build only outside Expo Go, only to a remote Worker and only as
 * preview or production, and always only to the ingest route. The ask and the Settings group show only when this is
 * not null.
 */
export function sendEnv(build: BuildFacts): Env | null {
  if (!build.url || !build.key || !isIngestEndpoint(build.url)) return null;
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

/** What the ask's timing reads: the gate, the stored answer, the store's Fan and where the person is. */
export type AskState = {
  readonly canSend: boolean;
  readonly loaded: boolean;
  readonly sharing: Sharing | null;
  readonly fanId: number | null;
  readonly pathname: string;
};

/**
 * The ask is due once the store holds a signed-in Fan that is not the Demo, no answer is held and Connect is not open: after the sign-in that closes Connect, never on the first screen or while looking around.
 */
export function usageAskDue(state: AskState): boolean {
  if (!state.canSend || !state.loaded || state.sharing !== null) return false;
  if (state.fanId === null || isDemoFan(state.fanId)) return false;
  return screenFor(state.pathname) !== 'connect';
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
  /** `expo-updates` `channel`: fixed when the binary is built, so an EAS Update never changes it. */
  readonly channel: string | null;
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
    channel: app.channel !== null && app.channel !== '' && WIRE.channelPattern.test(app.channel) ? app.channel : null,
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

/** The status itself where it names a cause; 0, no HTTP status, is `none`. */
function statusCode(status: number | null): TallyProps<'gather_finished'>['status_code'] {
  if (status === null || status === 0) return 'none';
  if (status >= 200 && status < 300) return '2xx';
  if (status >= 500 && status < 600) return '5xx';
  const named = ['400', '401', '403', '404', '429'] as const;
  const code = named.find((value) => value === String(status));
  if (code !== undefined) return code;
  return status >= 400 && status < 500 ? 'other_4xx' : 'none';
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
      failed_step: chain.last.failedStep ?? 'none',
      status_code: statusCode(after.lastError === null ? null : after.lastStatus),
      feed_retried: chain.last.feedRetried,
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

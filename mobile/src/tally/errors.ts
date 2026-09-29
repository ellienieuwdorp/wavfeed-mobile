/**
 * Error Reports from the running app (task 0038 decision 10, ADR-0021, the plan's "Error capture on RN 0.86"): a
 * global handler chained in front of the one it finds, the Hermes rejection tracker turned on in release builds (RN
 * turns it on only in development), the boundary fallbacks and `reportCode` for handled failures. Each report is
 * written at once with `runSync` through `enqueueErrorSync`, whose statement checks the stored yes, so nothing is kept
 * while sharing is off, and leaves on the next flush or launch. The sink is the open store, set by the app state as it
 * opens, not by the sharing provider: a render error in the root tears that provider down before its effects run, and
 * the root fallback reports after it is gone. Reports from before the store opens wait in memory. `console.error` is
 * not captured.
 */
import type { SQLiteDatabase } from 'expo-sqlite';

import type { ErrorCode, ErrorSource, Screen } from './catalogue';
import { buildErrorReport, type ErrorReport } from './errorReport';
import { enqueueErrorSync, MAX_ERRORS_PER_LAUNCH, type Launch } from './outbox';

export type ErrorReports = {
  /** Never throws, since every caller is on its way to something that must still run. */
  readonly report: (thrown: unknown, source: ErrorSource, fatal: boolean, code?: ErrorCode) => void;
  /** A boundary fallback's report: an error React hands to more than one mount (StrictMode) is written once. */
  readonly reportCaught: (thrown: unknown) => void;
  /** The open store, or null while it is being removed; the reports waiting for it are written or dropped with it. */
  readonly setSink: (db: SQLiteDatabase | null) => void;
  readonly setScreen: (screen: Screen) => void;
};

export function createErrorReports(now: () => number): ErrorReports {
  // undefined until the store first opens.
  let sink: SQLiteDatabase | null | undefined;
  let waiting: ErrorReport[] = [];
  let screen: Screen = 'other';
  const launch: Launch = { errorsWritten: 0 };
  const caught = new WeakSet<object>();

  const report: ErrorReports['report'] = (thrown, source, fatal, code) => {
    try {
      const built = buildErrorReport(thrown, { t: now(), source, fatal, screen, code });
      if (sink === undefined) {
        if (waiting.length < MAX_ERRORS_PER_LAUNCH) waiting.push(built);
      } else if (sink !== null) enqueueErrorSync(sink, launch, built);
    } catch {
      // A report that cannot be built or written is lost.
    }
  };

  return {
    report,
    reportCaught(thrown) {
      if (typeof thrown === 'object' && thrown !== null) {
        if (caught.has(thrown)) return;
        caught.add(thrown);
      }
      report(thrown, 'boundary', false);
    },
    setSink(db) {
      sink = db;
      const held = waiting;
      waiting = [];
      if (db !== null) for (const built of held) enqueueErrorSync(db, launch, built);
    },
    setScreen(next) {
      screen = next;
    },
  };
}

export const errorReports = createErrorReports(Date.now);

/** A handled failure worth a report (the plan's closed codes): a replay after a parser change, a fold. */
export function reportCode(code: ErrorCode, thrown: unknown): void {
  errorReports.report(thrown, 'code', false, code);
}

type Handler = (error: unknown, isFatal?: boolean) => void;
export type ErrorUtilsLike = { readonly getGlobalHandler: () => Handler; readonly setGlobalHandler: (handler: Handler) => void };
type TrackerOptions = { allRejections: boolean; onUnhandled: (id: number, rejection: unknown) => void; onHandled: (id: number) => void };
export type HermesLike = { readonly enablePromiseRejectionTracker?: (options: TrackerOptions) => void };
export type CaptureEnv = { readonly errorUtils: ErrorUtilsLike | undefined; readonly hermes: HermesLike | null | undefined; readonly dev: boolean };

const OURS = Symbol.for('wavfeed.errorCapture');

function globalEnv(): CaptureEnv {
  const scope = globalThis as { ErrorUtils?: ErrorUtilsLike; HermesInternal?: HermesLike | null };
  return { errorUtils: scope.ErrorUtils, hermes: scope.HermesInternal, dev: __DEV__ };
}

/**
 * Chains the global handler, the one expo-router wraps to hide the splash screen, and in a release build turns on
 * Hermes' rejection tracker, which RN 0.86's `polyfillPromise.js` enables only under `__DEV__`, where LogBox owns it.
 * The report is written before the previous handler runs, since a fatal there ends the process. Only a process's
 * first fatal is written; the ones after it are its echoes. A second install, as Fast Refresh runs, changes nothing.
 * Returns what it hooked, for the verification build's log.
 */
export function installErrorCapture(reports: ErrorReports = errorReports, env: CaptureEnv = globalEnv()): { handler: boolean; rejections: boolean } {
  const { errorUtils, hermes } = env;
  let handler = false;
  const previous = errorUtils?.getGlobalHandler();
  if (errorUtils && !(previous && OURS in previous)) {
    let fatalSeen = false;
    const capture: Handler = (error, isFatal) => {
      if (!(isFatal && fatalSeen)) reports.report(error, 'global', isFatal === true);
      if (isFatal) fatalSeen = true;
      previous?.(error, isFatal);
    };
    errorUtils.setGlobalHandler(Object.assign(capture, { [OURS]: true }));
    handler = true;
  }
  let rejections = false;
  if (!env.dev && typeof hermes?.enablePromiseRejectionTracker === 'function') {
    hermes.enablePromiseRejectionTracker({
      allRejections: true,
      onUnhandled: (_id, rejection) => reports.report(rejection, 'promise', false),
      onHandled: () => undefined,
    });
    rejections = true;
  }
  return { handler, rejections };
}

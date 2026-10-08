/**
 * Whether only the store can bring this install up to date (task 0064, decision 1). wavfeed.com serves
 * `mobile/store-builds.json`, the newest store build per platform and its native fingerprint. A newer store build whose
 * fingerprint is not this binary's runtime version is one no EAS Update can deliver, so only the store can bring the
 * install up to date. Imports nothing native, so the same file runs on the patched old builds (decision 4). The answer
 * and the install's facts are arguments.
 */
export const STORE_BUILDS_URL = 'https://wavfeed.com/store-builds.json';
export const CHECK_TIMEOUT_MS = 10_000;
/**
 * Where a tester installs a store build, tried in order (decision 3): the TestFlight app on wavfeed's page (`itms-beta`,
 * with the App Store Connect app id from eas.json), then the public link when TestFlight is missing; the Play Store app
 * on the listing, then its web page.
 */
export const STORE_URLS = {
  ios: ['itms-beta://beta.itunes.apple.com/v1/app/6817516210', 'https://testflight.apple.com/join/saJFWAqV'],
  android: ['market://details?id=com.wavfeed.app', 'https://play.google.com/store/apps/details?id=com.wavfeed.app'],
} as const;

export type Installed = {
  readonly platform: 'ios' | 'android';
  /** `Application.nativeBuildVersion`: CFBundleVersion or versionCode, as a string. */
  readonly build: string | null;
  /** `Updates.runtimeVersion`: the fingerprint this binary answers updates with. */
  readonly runtime: string | null;
};

const isBuild = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 1;

/** The store build only the store can deliver to this install, or null; anything malformed reads as none. */
export function storeOnlyBuild(answer: unknown, installed: Installed): number | null {
  const mine = Number(installed.build);
  if (!isBuild(mine) || installed.runtime === null) return null;
  const entry = typeof answer === 'object' && answer !== null ? (answer as Record<string, unknown>)[installed.platform] : undefined;
  if (typeof entry !== 'object' || entry === null) return null;
  const { build, fingerprint } = entry as Record<string, unknown>;
  if (!isBuild(build) || typeof fingerprint !== 'string' || !/^[0-9a-f]{40}$/.test(fingerprint)) return null;
  return build > mine && fingerprint !== installed.runtime ? build : null;
}

/** Reads `store-builds.json`, giving up after `CHECK_TIMEOUT_MS`; null on any failure. */
export async function readStoreBuilds(): Promise<unknown> {
  // A controller and a timer, since Hermes has no AbortSignal.timeout.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CHECK_TIMEOUT_MS);
  try {
    const res = await fetch(STORE_BUILDS_URL, { signal: controller.signal, headers: { accept: 'application/json' } });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

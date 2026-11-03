/**
 * Whether only a new build can bring this install up to date.
 * dl.wavfeed.com serves `store-builds.json`, written by the release jobs from the release tags: per distribution the
 * newest build testers can install and its native fingerprint, and for the website APK its address and MD5 too. A
 * newer build whose fingerprint is not this binary's runtime version is one no EAS Update can deliver. Which entry an
 * install reads follows its EAS channel, fixed in the binary: iOS reads `ios`, an Android Play build `android`, and an
 * Android build on channel `apk` or `preview` (the website APKs) `apk`. Imports nothing native, so the same file runs
 * on the patched old builds. The answer and the install's facts are arguments.
 */
export const STORE_BUILDS_URL = 'https://dl.wavfeed.com/store-builds.json';
export const CHECK_TIMEOUT_MS = 10_000;
/**
 * Where a tester installs a store build, tried in order: the TestFlight app on wavfeed's page
 * (`itms-beta`, with the App Store Connect app id from eas.json), then the public link when TestFlight is missing; the
 * Play Store app on the listing, then its web page. The APK's address comes with its entry.
 */
export const STORE_URLS = {
  ios: ['itms-beta://beta.itunes.apple.com/v1/app/6817516210', 'https://testflight.apple.com/join/saJFWAqV'],
  android: ['market://details?id=com.wavfeed.app', 'https://play.google.com/store/apps/details?id=com.wavfeed.app'],
} as const;

export type Distribution = 'ios' | 'android' | 'apk';

export type Installed = {
  readonly platform: 'ios' | 'android';
  /** `Application.nativeBuildVersion`: CFBundleVersion or versionCode, as a string. */
  readonly build: string | null;
  /** `Updates.runtimeVersion`: the fingerprint this binary answers updates with. */
  readonly runtime: string | null;
  /** `Updates.channel`: the EAS channel the binary was built for. */
  readonly channel: string | null;
};

/** A build only a new install can bring: its number, and for the APK where it downloads from and its MD5. */
export type NewerBuild = { readonly distribution: Distribution; readonly build: number; readonly url?: string; readonly md5?: string };

const isBuild = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 1;

/** The entry an install reads, or null for one that checks nothing, such as an iOS preview build. */
export function distributionOf(installed: Installed): Distribution | null {
  if (installed.platform === 'ios') return installed.channel === 'production' ? 'ios' : null;
  if (installed.channel === 'apk' || installed.channel === 'preview') return 'apk';
  return installed.channel === 'production' ? 'android' : null;
}

/** The build only a new install can bring this one, or null; anything malformed reads as none. */
export function newerBuild(answer: unknown, installed: Installed): NewerBuild | null {
  const distribution = distributionOf(installed);
  const mine = Number(installed.build);
  if (distribution === null || !isBuild(mine) || installed.runtime === null) return null;
  const entry = typeof answer === 'object' && answer !== null ? (answer as Record<string, unknown>)[distribution] : undefined;
  if (typeof entry !== 'object' || entry === null) return null;
  const { build, fingerprint, url, md5 } = entry as Record<string, unknown>;
  if (!isBuild(build) || typeof fingerprint !== 'string' || !/^[0-9a-f]{40}$/.test(fingerprint)) return null;
  if (build <= mine || fingerprint === installed.runtime) return null;
  if (distribution !== 'apk') return { distribution, build };
  if (typeof url !== 'string' || !url.startsWith('https://') || typeof md5 !== 'string' || !/^[0-9a-f]{32}$/.test(md5)) return null;
  return { distribution, build, url, md5 };
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

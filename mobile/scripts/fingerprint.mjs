#!/usr/bin/env node
/**
 * Holds the tree's runtime fingerprint to the builds testers have (task 0051, decision 2; task 0065, decision 1). The
 * newest build of each distribution and the fingerprint it carries come from the release tags (`scripts/ledger.mjs`);
 * an EAS Update reaches a build only when it names that fingerprint. `current` computes this tree's per platform with
 * `expo-updates`, the code EAS Build and EAS Update resolve the runtime version with. `check` prints which
 * distributions an update from this tree reaches and exits 1 when it reaches none, or with `--all` when it misses any;
 * `--ci` turns a miss into a GitHub warning and exits 0, since a native change is allowed and only has to be seen;
 * `--platforms` prints the reached platforms alone, one per line, for `dev/update.sh`. `verify <platform> <fingerprint>`
 * refuses a binary that carries another fingerprint than this tree's, before `dev/release.sh` uploads it.
 */
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { DISTRIBUTIONS, newest, read } from './ledger.mjs';

export const PLATFORMS = ['ios', 'android'];
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Each distribution's newest build and whether this tree's fingerprint is the one it carries. */
export function compare(entries, current) {
  return Object.entries(DISTRIBUTIONS).map(([distribution, platform]) => {
    const build = newest(entries, distribution);
    return { distribution, platform, build: build?.build ?? null, reached: build !== null && build.runtime === current[platform] };
  });
}

const isFingerprint = (value) => typeof value === 'string' && /^[0-9a-f]{40}$/.test(value);

export function fingerprintOf(platform, cwd = ROOT) {
  const out = execFileSync('npx', ['expo-updates', 'fingerprint:generate', '--platform', platform], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
  const hash = JSON.parse(out).hash;
  if (!isFingerprint(hash)) throw new Error(`fingerprint:generate answered no hash for ${platform}`);
  return hash;
}

export function current(cwd = ROOT) {
  return Object.fromEntries(PLATFORMS.map((platform) => [platform, fingerprintOf(platform, cwd)]));
}

function main(args) {
  const [command, ...rest] = args;
  if (command === 'verify') {
    const [platform, carried] = rest;
    if (!PLATFORMS.includes(platform) || !isFingerprint(carried)) throw new Error('usage: fingerprint.mjs verify ios|android <the fingerprint the binary carries>');
    const tree = fingerprintOf(platform);
    if (carried !== tree) throw new Error(`the ${platform} binary carries ${carried} and this tree ${tree}`);
    console.log(`the ${platform} binary carries this tree's fingerprint ${carried}`);
    return 0;
  }
  if (command === 'current') {
    console.log(JSON.stringify(current()));
    return 0;
  }
  if (command !== 'check') throw new Error('usage: fingerprint.mjs check [--all] [--ci] [--platforms] | current | verify ios|android <fingerprint>');
  const prints = current();
  const results = compare(read(ROOT), prints);
  const reached = results.filter((r) => r.reached);
  const missed = results.filter((r) => !r.reached);
  if (rest.includes('--platforms')) {
    for (const platform of PLATFORMS) if (reached.some((r) => r.platform === platform)) console.log(platform);
  } else {
    for (const r of results) {
      const verdict = r.reached ? `an update reaches ${r.distribution} build ${r.build}` : `differs from ${r.distribution} build ${r.build ?? '(none tagged)'}, so it needs a new one`;
      console.log(`${r.platform} ${prints[r.platform]}: ${verdict}`);
    }
  }
  if (rest.includes('--ci')) {
    if (missed.length > 0) {
      const which = missed.map((r) => `${r.distribution} build ${r.build ?? '(none)'}`).join(', ');
      console.log(`::warning title=Needs a new build::This tree's runtime fingerprint differs from ${which}, so the next release builds anew there instead of sending an update (mobile/README.md, Releases).`);
    }
    return 0;
  }
  return reached.length === 0 || (rest.includes('--all') && missed.length > 0) ? 1 : 0;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    console.error(`fingerprint.mjs: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}

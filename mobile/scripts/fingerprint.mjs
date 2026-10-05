#!/usr/bin/env node
/**
 * Holds the tree's runtime fingerprint to the store builds testers have installed (task 0051, decision 2).
 * `store-builds.json` names the newest store build per platform and the fingerprint it carries, the runtime version an
 * EAS Update must name to land on it. `check` computes this tree's fingerprint per platform with `expo-updates`, the
 * code EAS Build and EAS Update resolve the runtime version with, and prints which platforms an update from this tree
 * reaches; it exits 1 when it reaches none, or with `--all` when it misses any. `--ci` turns a miss into a GitHub
 * warning naming the platforms that need a new store build, and exits 0, since a native change is allowed and only has
 * to be seen. `--platforms` prints the reached platforms alone, one per line, for `dev/update.sh`. `record <platform> <n>
 * <fingerprint>` writes the fingerprint a store binary carries as that platform's build `n`, and refuses when it is not
 * this tree's; `dev/release.sh` reads it out of the binary and runs it with `--dry-run` before the upload, then for real.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const PLATFORMS = ['ios', 'android'];
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const RECORD = join(ROOT, 'store-builds.json');

/** Each platform's store build and whether this tree's fingerprint is the one it carries. */
export function compare(record, current) {
  return PLATFORMS.map((platform) => {
    const build = record[platform];
    return { platform, build: build?.build ?? null, reached: build !== undefined && build.fingerprint === current[platform] };
  });
}

const isFingerprint = (value) => typeof value === 'string' && /^[0-9a-f]{40}$/.test(value);

function fingerprintOf(platform) {
  const out = execFileSync('npx', ['expo-updates', 'fingerprint:generate', '--platform', platform], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
  const hash = JSON.parse(out).hash;
  if (!isFingerprint(hash)) throw new Error(`fingerprint:generate answered no hash for ${platform}`);
  return hash;
}

function current() {
  return Object.fromEntries(PLATFORMS.map((platform) => [platform, fingerprintOf(platform)]));
}

function main(args) {
  const [command, ...rest] = args;
  if (command === 'record') {
    const [platform, number, carried] = rest;
    const build = Number(number);
    if (!PLATFORMS.includes(platform) || !Number.isSafeInteger(build) || build < 1 || !isFingerprint(carried)) {
      throw new Error('usage: fingerprint.mjs record ios|android <build number> <the fingerprint the binary carries>');
    }
    const tree = fingerprintOf(platform);
    if (carried !== tree) throw new Error(`the ${platform} binary carries ${carried} and this tree ${tree}; not recorded`);
    if (rest.includes('--dry-run')) {
      console.log(`the ${platform} binary carries this tree's fingerprint ${carried}`);
      return 0;
    }
    const record = JSON.parse(readFileSync(RECORD, 'utf8'));
    record[platform] = { build, fingerprint: carried };
    writeFileSync(RECORD, `${JSON.stringify(record, null, 2)}\n`);
    console.log(`recorded ${platform} build ${build}: ${carried}`);
    return 0;
  }
  if (command !== 'check') throw new Error('usage: fingerprint.mjs check [--all] [--ci] [--platforms] | record ios|android <build number>');
  const prints = current();
  const results = compare(JSON.parse(readFileSync(RECORD, 'utf8')), prints);
  const reached = results.filter((r) => r.reached);
  const missed = results.filter((r) => !r.reached);
  if (rest.includes('--platforms')) {
    for (const r of reached) console.log(r.platform);
  } else {
    for (const r of results) {
      const verdict = r.reached ? `an update reaches store build ${r.build}` : `differs from store build ${r.build ?? '(none recorded)'}, so it needs a new one`;
      console.log(`${r.platform} ${prints[r.platform]}: ${verdict}`);
    }
  }
  if (rest.includes('--ci')) {
    if (missed.length > 0) {
      const which = missed.map((r) => `${r.platform} build ${r.build ?? '(none)'}`).join(' and ');
      console.log(`::warning title=Needs a new store build::This tree's runtime fingerprint differs from ${which} in store-builds.json, so an EAS Update from it reaches no installed build there (mobile/README.md, Builds for the phone and for testers).`);
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

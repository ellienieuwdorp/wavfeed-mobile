#!/usr/bin/env node
/**
 * Holds the tree's runtime fingerprint to the store builds testers have installed (task 0051, decision 2).
 * `store-builds.json` names the newest store build per platform and the fingerprint it carries, the runtime version an
 * EAS Update must name to land on it. `check` computes this tree's fingerprint per platform with `expo-updates`, the
 * code EAS Build and EAS Update resolve the runtime version with, and prints which platforms an update from this tree
 * reaches; it exits 1 when it reaches none, or with `--all` when it misses any. `--ci` turns a miss into a GitHub
 * warning naming the platforms that need a new store build, and exits 0, since a native change is allowed and only has
 * to be seen. `--platforms` prints the reached platforms alone, one per line, for `dev/update.sh`. `record <platform> <n>`
 * writes the tree's fingerprint as that platform's store build `n`, which `dev/build.sh` runs after an upload.
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

function fingerprintOf(platform) {
  const out = execFileSync('npx', ['expo-updates', 'fingerprint:generate', '--platform', platform], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  const hash = JSON.parse(out).hash;
  if (!/^[0-9a-f]{40}$/.test(hash)) throw new Error(`fingerprint:generate answered no hash for ${platform}`);
  return hash;
}

function current() {
  return Object.fromEntries(PLATFORMS.map((platform) => [platform, fingerprintOf(platform)]));
}

function main(args) {
  const [command, ...rest] = args;
  if (command === 'record') {
    const [platform, number] = rest;
    const build = Number(number);
    if (!PLATFORMS.includes(platform) || !Number.isSafeInteger(build) || build < 1) throw new Error('usage: fingerprint.mjs record ios|android <build number>');
    const record = JSON.parse(readFileSync(RECORD, 'utf8'));
    record[platform] = { build, fingerprint: fingerprintOf(platform) };
    writeFileSync(RECORD, `${JSON.stringify(record, null, 2)}\n`);
    console.log(`recorded ${platform} build ${build}: ${record[platform].fingerprint}`);
    return 0;
  }
  if (command !== 'check') throw new Error('usage: fingerprint.mjs check [--all] [--ci] [--platforms] | record ios|android <build number>');
  const results = compare(JSON.parse(readFileSync(RECORD, 'utf8')), current());
  const reached = results.filter((r) => r.reached);
  const missed = results.filter((r) => !r.reached);
  if (rest.includes('--platforms')) {
    for (const r of reached) console.log(r.platform);
  } else {
    for (const r of results) {
      console.log(`${r.platform}: ${r.reached ? `an update reaches store build ${r.build}` : `native code differs from store build ${r.build ?? 'none'}; it needs a new store build`}`);
    }
  }
  if (rest.includes('--ci')) {
    if (missed.length > 0) {
      console.log(`::warning title=Needs a new store build::This changes the native app on ${missed.map((r) => r.platform).join(' and ')}, so an EAS Update from it reaches no installed build there (mobile/README.md, Builds for the phone and for testers).`);
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

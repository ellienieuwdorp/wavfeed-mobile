#!/usr/bin/env node
/**
 * The release record (ADR-0026): annotated tags `ios/build-<n>`, `android/build-<n>`,
 * `apk/build-<n>` and `ota/<channel>/<platforms>/<date>-<group>`, each message ending in `Key: value` trailers. `read`
 * lists them from git with the commit each one names, `newest` picks a distribution's newest build, and `tagMessage`
 * writes the message the release scripts tag with, so writing and reading share one shape. `node scripts/ledger.mjs`
 * prints the newest build per distribution and `--json` the whole record; `tag <name> <summary> [Key=Value ...]` tags
 * HEAD of the repository it runs in and publishes the tag; `publish-tag <name>` resumes that publication alone.
 */
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** A distribution, the store or page testers install from, and the platform its builds run on. */
export const DISTRIBUTIONS = { testflight: 'ios', play: 'android', apk: 'android' };
/** The tag prefix each distribution's builds take. */
export const PREFIX = { testflight: 'ios', play: 'android', apk: 'apk' };

const SEP = '\u001f';
const END = '\u001e';
const RELEASE_TAG = /^(ios|android|apk)\/build-\d+$|^ota\/[a-z0-9-]+\/[a-z+]+\/\d{4}-\d{2}-\d{2}-[0-9a-f]{8}$/;

/** The trailers at the end of a tag message, as an object keyed by lower-case name. */
export function trailers(message) {
  const out = {};
  for (const line of message.trim().split('\n').reverse()) {
    const match = /^([A-Za-z][A-Za-z0-9-]*): (.+)$/.exec(line.trim());
    if (!match) break;
    out[match[1].toLowerCase()] = match[2].trim();
  }
  return out;
}

/** One tag as a record entry, or null for a tag that is not a release. */
export function entryOf(tag, commit, message, date) {
  const t = trailers(message);
  const build = /^(ios|android|apk)\/build-(\d+)$/.exec(tag);
  if (build) {
    const distribution = Object.keys(PREFIX).find((d) => PREFIX[d] === build[1]);
    const entry = { kind: 'build', tag, commit, date, distribution, platform: DISTRIBUTIONS[distribution], build: Number(build[2]), runtime: t.runtime ?? null, channel: t.channel ?? 'production' };
    // An APK's tag carries where it downloads from and its digests.
    return t.url ? { ...entry, url: t.url, md5: t.md5 ?? null, sha256: t.sha256 ?? null } : entry;
  }
  const ota = /^ota\/([a-z0-9-]+)\/([a-z+]+)\/(\d{4}-\d{2}-\d{2})-([0-9a-f]{8})$/.exec(tag);
  if (ota) {
    return { kind: 'ota', tag, commit, date, channel: ota[1], platforms: ota[2].split('+'), group: t.group ?? null, runtime: t.runtime ?? null, rollout: t.rollout ? Number(t.rollout) : null, patch: t.patch ?? null };
  }
  return null;
}

/** Every release tag in the repository at `cwd`, oldest first. */
export function read(cwd = process.cwd()) {
  const format = ['%(refname:strip=2)', '%(*objectname)', '%(objectname)', '%(creatordate:iso-strict)', '%(contents)'].join(SEP) + END;
  const out = execFileSync('git', ['for-each-ref', '--sort=creatordate', `--format=${format}`, 'refs/tags/ios', 'refs/tags/android', 'refs/tags/apk', 'refs/tags/ota'], { cwd, encoding: 'utf8' });
  return out
    .split(END)
    .map((chunk) => chunk.replace(/^\n/, ''))
    .filter((chunk) => chunk.length > 0)
    .map((chunk) => {
      const [tag, peeled, object, date, message] = chunk.split(SEP);
      return entryOf(tag, peeled || object, message, date);
    })
    .filter((entry) => entry !== null);
}

/** The newest build of a distribution in `entries`, by build number, or null. */
export function newest(entries, distribution) {
  return entries.filter((e) => e.kind === 'build' && e.distribution === distribution).reduce((best, e) => (best === null || e.build > best.build ? e : best), null);
}

/** The annotated message a release tag carries: a first line for people, then the trailers this file reads. */
export function tagMessage(summary, fields) {
  const lines = Object.entries(fields)
    .filter(([, value]) => value !== null && value !== undefined && value !== '')
    .map(([key, value]) => `${key}: ${value}`);
  return `${summary}\n\n${lines.join('\n')}\n`;
}

// Publication confirms the annotated object on origin; retry never retags or republishes a build/update.
function publishTag(name, cwd) {
  if (!RELEASE_TAG.test(name)) throw new Error(`${name} is no release tag`);
  const ref = `refs/tags/${name}`;
  const object = execFileSync('git', ['rev-parse', '--verify', ref], { cwd, encoding: 'utf8' }).trim();
  if (execFileSync('git', ['cat-file', '-t', object], { cwd, encoding: 'utf8' }).trim() !== 'tag') throw new Error(`${name} is not annotated`);
  const remoteObject = () => {
    try {
      const refs = execFileSync('git', ['ls-remote', '--refs', 'origin', ref], { cwd, encoding: 'utf8' });
      return refs.trim().split('\n').map((line) => line.split('\t')).find(([, name]) => name === ref)?.[0] ?? null;
    } catch (cause) {
      throw new Error('could not confirm the release tag on origin', { cause });
    }
  };
  try {
    const before = remoteObject();
    if (before && before !== object) throw new Error(`origin has a different annotated object for ${name}; no tag was replaced`);
    if (before !== object) {
      let pushError;
      try {
        execFileSync('git', ['push', '--quiet', '--no-follow-tags', 'origin', `${object}:${ref}`], { cwd, stdio: ['ignore', 'inherit', 'inherit'] });
      } catch (cause) {
        pushError = cause;
      }
      if (remoteObject() !== object) throw new Error(`origin does not advertise the release tag ${name}`, { cause: pushError });
    }
    console.log(`ledger: published ${name} on origin`);
  } catch (cause) {
    const script = `'${fileURLToPath(import.meta.url).replaceAll("'", "'\\''")}'`;
    throw new Error(`ledger: ${cause.message}; ${name} is kept locally\nledger: resume tag publication only: node ${script} publish-tag ${name}`, { cause });
  }
}

/** Tags HEAD once; unconfirmed publication throws while keeping that annotated release record. */
export function tag(name, summary, fields, cwd = process.cwd()) {
  if (!RELEASE_TAG.test(name)) throw new Error(`${name} is no release tag`);
  execFileSync('git', ['tag', '-a', name, 'HEAD', '-F', '-'], { cwd, input: tagMessage(summary, fields) });
  publishTag(name, cwd);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href && ['tag', 'publish-tag'].includes(process.argv[2])) {
  const [, , , name, summary, ...pairs] = process.argv;
  const fields = Object.fromEntries(pairs.map((pair) => [pair.slice(0, pair.indexOf('=')), pair.slice(pair.indexOf('=') + 1)]));
  const publishing = process.argv[2] === 'publish-tag';
  if (!name || (publishing ? process.argv.length !== 4 : !summary || pairs.some((pair) => !/^[A-Z][A-Za-z0-9-]*=./.test(pair)))) {
    console.error('usage: ledger.mjs tag <name> <summary> [Key=Value ...] | publish-tag <name>');
    process.exit(1);
  }
  try {
    if (publishing) publishTag(name, process.cwd());
    else tag(name, summary, fields);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
} else if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const entries = read();
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(entries, null, 2));
  } else {
    for (const distribution of Object.keys(DISTRIBUTIONS)) {
      const e = newest(entries, distribution);
      console.log(e === null ? `${distribution}: none` : `${distribution}: build ${e.build} from ${e.commit.slice(0, 7)}, runtime ${e.runtime ?? 'unknown'}`);
    }
  }
}

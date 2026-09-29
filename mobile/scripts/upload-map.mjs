#!/usr/bin/env node
/**
 * Puts a composed Hermes source map in the EU R2 bucket `tallies-maps` (task 0038 decision 16, the plan's "Source maps
 * per platform") at `maps/wavfeed/<platform>/<id>/index.map`, the key the board's `/api/maps/<platform>/<id>` reads,
 * where `id` is the native build number for an embedded bundle and the EAS Update id for an update, as each Error
 * Report's `ctx` names them. With no arguments it is EAS Build's `eas-build-on-success` hook: the map is Android's
 * gradle output or iOS's `SOURCEMAP_FILE` (set in `eas.json`), and the build number is read from the native project
 * EAS just built. `dev/update.sh` passes `--platform`, `--id` and `--file` for each update. The request is signed with
 * `aws4fetch` and the bucket-scoped token in the sensitive EAS variables `TALLY_MAPS_KEY_ID`, `TALLY_MAPS_SECRET` and
 * `TALLY_MAPS_ENDPOINT`; without them it uploads nothing and says so, so a self-build of the public repo still passes.
 */
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { AwsClient } from 'aws4fetch';

export const BUCKET = 'tallies-maps';
export const ANDROID_MAP = 'android/app/build/generated/sourcemaps/react/release/index.android.bundle.map';
/**
 * The board's rule for a map's name: `WIRE.buildPattern` or `WIRE.uuidPattern` from `src/tally/catalogue.ts`, holding
 * a letter or digit. Copied, since EAS Build's Node may predate type stripping; the test holds the copy to the source.
 */
const BUILD = /^[0-9A-Za-z.]{1,20}$/;
const UPDATE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isMapId = (id) => (BUILD.test(id) || UPDATE.test(id)) && /[0-9A-Za-z]/.test(id);
const TRIES = 3;

export function mapKey(platform, id) {
  if (platform !== 'ios' && platform !== 'android') throw new Error(`no platform ${platform}`);
  if (!isMapId(id)) throw new Error(`no map id ${id}`);
  return `maps/wavfeed/${platform}/${id}/index.map`;
}

/** A signed PUT of `body` to the bucket's S3 endpoint; `datetime` (`YYYYMMDDTHHMMSSZ`) fixes the clock in tests. */
export function signedUpload({ endpoint, keyId, secret, platform, id, body, datetime }) {
  const client = new AwsClient({ accessKeyId: keyId, secretAccessKey: secret, service: 's3', region: 'auto' });
  const url = `${endpoint.replace(/\/+$/, '')}/${BUCKET}/${mapKey(platform, id)}`;
  const headers = { 'content-type': 'application/json', 'x-amz-content-sha256': createHash('sha256').update(body).digest('hex') };
  return client.sign(url, { method: 'PUT', headers, body, aws: datetime ? { datetime } : {} });
}

/** CFBundleVersion from the app target's Info.plist, or the build setting it names; versionCode from build.gradle. */
export function buildNumber(platform, root) {
  if (platform === 'android') {
    const gradle = readFileSync(join(root, 'android/app/build.gradle'), 'utf8');
    const code = /^\s*versionCode\s+(\d+)/m.exec(gradle)?.[1];
    if (!code) throw new Error('no versionCode in android/app/build.gradle');
    return code;
  }
  const ios = join(root, 'ios');
  const target = readdirSync(ios).find((name) => existsSync(join(ios, `${name}.xcodeproj`)) && existsSync(join(ios, name, 'Info.plist')));
  if (!target) throw new Error('no app target with an Info.plist under ios/');
  const plist = readFileSync(join(ios, target, 'Info.plist'), 'utf8');
  let version = /<key>CFBundleVersion<\/key>\s*<string>([^<]*)<\/string>/.exec(plist)?.[1];
  const setting = /^\$\((\w+)\)$/.exec(version ?? '')?.[1];
  if (setting) {
    const project = readFileSync(join(ios, `${target}.xcodeproj/project.pbxproj`), 'utf8');
    version = new RegExp(`\\b${setting} = "?([^";]+)"?;`).exec(project)?.[1];
  }
  if (!version) throw new Error(`no CFBundleVersion in ios/${target}/Info.plist`);
  return version;
}

async function put(request, send, wait) {
  for (let attempt = 1; ; attempt += 1) {
    const answer = await send(request.clone()).catch((error) => ({ ok: false, status: String(error) }));
    if (answer.ok) return;
    if (attempt === TRIES) throw new Error(`the bucket answered ${answer.status}`);
    await wait(2_000 * attempt);
  }
}

function flags(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!/^--(platform|id|file)$/.test(argv[i]) || argv[i + 1] === undefined) throw new Error(`usage: upload-map.mjs [--platform ios|android --id <id> --file <map>]`);
    out[argv[i].slice(2)] = argv[i + 1];
  }
  return out;
}

/** Returns the key written, or null when this environment holds no bucket token. */
export async function main({ argv, env, cwd, send = fetch, wait = (ms) => new Promise((done) => setTimeout(done, ms)), log = console.log }) {
  const given = flags(argv);
  const { TALLY_MAPS_KEY_ID: keyId, TALLY_MAPS_SECRET: secret, TALLY_MAPS_ENDPOINT: endpoint } = env;
  if (!keyId || !secret || !endpoint) {
    log('upload-map: TALLY_MAPS_KEY_ID, TALLY_MAPS_SECRET and TALLY_MAPS_ENDPOINT are not all set here, so no map was uploaded');
    return null;
  }
  const platform = given.platform ?? env.EAS_BUILD_PLATFORM;
  let file = given.file;
  if (!file && platform === 'android') file = ANDROID_MAP;
  if (!file && platform === 'ios') {
    if (!env.SOURCEMAP_FILE) throw new Error('SOURCEMAP_FILE is not set, so the iOS build wrote no map (mobile/eas.json)');
    file = env.SOURCEMAP_FILE;
  }
  if (!file) throw new Error('no platform: pass --platform, or run as the EAS Build hook');
  const path = resolve(cwd, file);
  if (!existsSync(path)) throw new Error(`no map at ${file}`);
  const id = given.id ?? buildNumber(platform, cwd);
  const request = await signedUpload({ endpoint, keyId, secret, platform, id, body: readFileSync(path) });
  await put(request, send, wait);
  const key = mapKey(platform, id);
  log(`upload-map: ${file} is ${BUCKET}/${key}`);
  return key;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main({ argv: process.argv.slice(2), env: process.env, cwd: process.cwd() }).catch((error) => {
    console.error(`upload-map: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}

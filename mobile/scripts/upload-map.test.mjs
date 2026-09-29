/**
 * The map upload (task 0038 decision 16): the key the board reads, a SigV4 signature checked by a second
 * implementation over node:crypto with a fixed clock, and the EAS hook finding each platform's map and build number.
 */
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { createHash, createHmac } from 'node:crypto';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';

import { WIRE } from '../src/tally/catalogue.ts';
import { ANDROID_MAP, isMapId, main, mapKey, signedUpload } from './upload-map.mjs';

const KEYS = { TALLY_MAPS_KEY_ID: 'a1b2c3', TALLY_MAPS_SECRET: 's3cr3t', TALLY_MAPS_ENDPOINT: 'https://acct.eu.r2.cloudflarestorage.com/' };
const MAP = '{"version":3,"sources":["src/app/player.tsx"],"mappings":"AAAA"}';

test("the key is the board's: maps/wavfeed/<platform>/<build or update id>/index.map", () => {
  assert.equal(mapKey('ios', '37'), 'maps/wavfeed/ios/37/index.map');
  assert.equal(mapKey('android', '0e5c4f7a-2d11-4b1e-8f3a-9b6d0c2e4a55'), 'maps/wavfeed/android/0e5c4f7a-2d11-4b1e-8f3a-9b6d0c2e4a55/index.map');
  for (const [platform, id] of [['web', '37'], ['ios', '../37'], ['ios', '...'], ['ios', '37/index.map'], ['ios', '']]) {
    assert.throws(() => mapKey(platform, id), `${platform} ${id}`);
  }
});

test("a map is named as the ingest names a build or an update, the rule the board's /api/maps checks", () => {
  const board = (id) => (WIRE.buildPattern.test(id) || WIRE.uuidPattern.test(id)) && /[0-9A-Za-z]/.test(id);
  for (const id of ['37', '1.0.0', 'a'.repeat(20), 'a'.repeat(21), '...', '..', '0e5c4f7a-2d11-4b1e-8f3a-9b6d0c2e4a55', '0E5C4F7A-2D11-4B1E-8F3A-9B6D0C2E4A55', '0e5c4f7a-2d11', '37%2F', '']) {
    assert.equal(isMapId(id), board(id), id);
  }
});

/** SigV4 as AWS documents it, written apart from aws4fetch: the signature the request carries must be this one. */
function expectedSignature(request, body, secret) {
  const url = new URL(request.url);
  const auth = request.headers.get('authorization');
  const [, scope, signed] = /Credential=[^/]+\/([^,]+), SignedHeaders=([^,]+), Signature=/.exec(auth);
  const names = signed.split(';');
  const canonical = [
    request.method,
    url.pathname,
    '',
    // A Request never carries `host`; the URL does.
    ...names.map((name) => `${name}:${(name === 'host' ? url.host : request.headers.get(name)).trim()}`),
    '',
    signed,
    createHash('sha256').update(body).digest('hex'),
  ].join('\n');
  const date = request.headers.get('x-amz-date');
  const toSign = ['AWS4-HMAC-SHA256', date, scope, createHash('sha256').update(canonical).digest('hex')].join('\n');
  const [day, region, service] = scope.split('/');
  let key = `AWS4${secret}`;
  for (const part of [day, region, service, 'aws4_request']) key = createHmac('sha256', key).update(part).digest();
  return createHmac('sha256', key).update(toSign).digest('hex');
}

test('the upload is a PUT signed for R2 at the fixed clock, over the body it carries', async () => {
  const body = Buffer.from(MAP);
  const request = await signedUpload({
    endpoint: KEYS.TALLY_MAPS_ENDPOINT,
    keyId: KEYS.TALLY_MAPS_KEY_ID,
    secret: KEYS.TALLY_MAPS_SECRET,
    platform: 'ios',
    id: '37',
    body,
    datetime: '20260929T120000Z',
  });
  assert.equal(request.method, 'PUT');
  assert.equal(request.url, 'https://acct.eu.r2.cloudflarestorage.com/tallies-maps/maps/wavfeed/ios/37/index.map');
  assert.equal(request.headers.get('x-amz-date'), '20260929T120000Z');
  const auth = request.headers.get('authorization');
  assert.match(auth, /^AWS4-HMAC-SHA256 Credential=a1b2c3\/20260929\/auto\/s3\/aws4_request, SignedHeaders=[^,]*x-amz-content-sha256/);
  assert.equal(/Signature=(\w+)$/.exec(auth)[1], expectedSignature(request, body, KEYS.TALLY_MAPS_SECRET));
  assert.deepEqual(Buffer.from(await request.arrayBuffer()), body);
});

function project(files) {
  const root = mkdtempSync(join(tmpdir(), 'wavfeed-map-'));
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(root, path, '..'), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}

function bucket() {
  const puts = [];
  return { puts, send: async (request) => (puts.push(request.url), { ok: true, status: 200 }) };
}

const plist = (version) => `<plist><dict><key>CFBundleVersion</key>\n\t<string>${version}</string></dict></plist>`;

describe('as the EAS Build hook', () => {
  const quiet = () => undefined;

  test('iOS uploads SOURCEMAP_FILE under the build number EAS wrote, from the plist or the setting it names', async () => {
    for (const [files, want] of [
      [{ 'ios/wavfeed/Info.plist': plist('38') }, '38'],
      [{ 'ios/wavfeed/Info.plist': plist('$(CURRENT_PROJECT_VERSION)'), 'ios/wavfeed.xcodeproj/project.pbxproj': 'CURRENT_PROJECT_VERSION = 39;' }, '39'],
    ]) {
      const root = project({ 'ios/wavfeed.xcodeproj/project.pbxproj': '', ...files, 'index.ios.map': MAP });
      const { puts, send } = bucket();
      const env = { ...KEYS, EAS_BUILD_PLATFORM: 'ios', SOURCEMAP_FILE: 'index.ios.map' };
      assert.equal(await main({ argv: [], env, cwd: root, send, log: quiet }), `maps/wavfeed/ios/${want}/index.map`);
      assert.deepEqual(puts, [`https://acct.eu.r2.cloudflarestorage.com/tallies-maps/maps/wavfeed/ios/${want}/index.map`]);
    }
  });

  test("Android uploads gradle's composed map under versionCode", async () => {
    const root = project({ 'android/app/build.gradle': 'android {\n  defaultConfig {\n    versionCode 41\n    versionName "1.0.0"\n  }\n}', [ANDROID_MAP]: MAP });
    const { puts, send } = bucket();
    assert.equal(await main({ argv: [], env: { ...KEYS, EAS_BUILD_PLATFORM: 'android' }, cwd: root, send, log: quiet }), 'maps/wavfeed/android/41/index.map');
    assert.equal(puts.length, 1);
  });

  test('Android takes the versionCode the release build merged, as EAS injects a remote one outside build.gradle', async () => {
    const manifest = (code) => `<manifest xmlns:android="http://schemas.android.com/apk/res/android" android:versionCode="${code}" android:versionName="1.0.0" package="com.wavfeed.app"/>`;
    const gradle = { 'android/app/build.gradle': 'android {\n  defaultConfig {\n    versionCode 1\n  }\n}' };
    const merged = 'android/app/build/intermediates/merged_manifest/release/processReleaseMainManifest/AndroidManifest.xml';
    const bundled = 'android/app/build/intermediates/bundle_manifest/release/processApplicationManifestReleaseForBundle/AndroidManifest.xml';
    const root = project({ ...gradle, [merged]: manifest(2), [bundled]: manifest(2), [ANDROID_MAP]: MAP });
    const { send } = bucket();
    assert.equal(await main({ argv: [], env: { ...KEYS, EAS_BUILD_PLATFORM: 'android' }, cwd: root, send, log: quiet }), 'maps/wavfeed/android/2/index.map');
    const split = project({ ...gradle, [merged]: manifest(2), [bundled]: manifest(3), [ANDROID_MAP]: MAP });
    await assert.rejects(main({ argv: [], env: { ...KEYS, EAS_BUILD_PLATFORM: 'android' }, cwd: split, send, log: quiet }), /disagree/);
  });

  test('without the bucket token it uploads nothing and passes, so a self-build still builds', async () => {
    const { puts, send } = bucket();
    const lines = [];
    assert.equal(await main({ argv: [], env: { EAS_BUILD_PLATFORM: 'android' }, cwd: tmpdir(), send, log: (line) => lines.push(line) }), null);
    assert.equal(puts.length, 0);
    assert.match(lines.join('\n'), /no map was uploaded/);
  });

  test("a token short of its three parts, or an update's upload without one, fails and puts nothing", async () => {
    const { puts, send } = bucket();
    const { TALLY_MAPS_SECRET: _, ...partial } = KEYS;
    await assert.rejects(main({ argv: [], env: { ...partial, EAS_BUILD_PLATFORM: 'android' }, cwd: tmpdir(), send, log: quiet }), /not all set/);
    const argv = ['--platform', 'ios', '--id', '0e5c4f7a-2d11-4b1e-8f3a-9b6d0c2e4a55', '--file', 'm.map'];
    await assert.rejects(main({ argv, env: {}, cwd: tmpdir(), send, log: quiet }), /not all set/);
    assert.equal(puts.length, 0);
  });

  test('a build with the token but no map fails loudly, and a refused upload fails after its retries', async () => {
    const root = project({ 'ios/wavfeed.xcodeproj/project.pbxproj': '', 'ios/wavfeed/Info.plist': plist('38') });
    await assert.rejects(main({ argv: [], env: { ...KEYS, EAS_BUILD_PLATFORM: 'ios' }, cwd: root, log: quiet }), /SOURCEMAP_FILE is not set/);
    await assert.rejects(main({ argv: [], env: { ...KEYS, EAS_BUILD_PLATFORM: 'ios', SOURCEMAP_FILE: 'gone.map' }, cwd: root, log: quiet }), /no map at gone.map/);
    const refused = [];
    const send = async (request) => (refused.push(request.url), { ok: false, status: 403 });
    const argv = ['--platform', 'ios', '--id', '38', '--file', 'm.map'];
    writeFileSync(join(root, 'm.map'), MAP);
    await assert.rejects(main({ argv, env: KEYS, cwd: root, send, wait: async () => undefined, log: quiet }), /answered 403/);
    assert.equal(refused.length, 3);
  });
});

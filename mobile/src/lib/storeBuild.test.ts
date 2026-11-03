/// <reference types="node" />
/** When only a new build can bring an install up to date, and which. */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { newerBuild, type Installed } from './storeBuild';

const OLD = 'a'.repeat(40);
const NEW = 'b'.repeat(40);
const MD5 = 'c'.repeat(32);
const ios7: Installed = { platform: 'ios', build: '7', runtime: OLD, channel: 'production' };
const play4: Installed = { platform: 'android', build: '4', runtime: OLD, channel: 'production' };
const apk3: Installed = { platform: 'android', build: '3', runtime: OLD, channel: 'preview' };
const apkEntry = { build: 10, fingerprint: NEW, url: 'https://dl.wavfeed.com/android/wavfeed-10.apk', md5: MD5 };

test('a newer build with other native code is one only a new install brings', () => {
  assert.deepEqual(newerBuild({ ios: { build: 8, fingerprint: NEW } }, ios7), { distribution: 'ios', build: 8 });
});

test('a newer build with the same native code is left to an update', () => {
  assert.equal(newerBuild({ ios: { build: 8, fingerprint: OLD } }, ios7), null);
});

test('the build this install is, or an older one, names nothing', () => {
  assert.equal(newerBuild({ ios: { build: 7, fingerprint: NEW } }, ios7), null);
  assert.equal(newerBuild({ ios: { build: 6, fingerprint: NEW } }, ios7), null);
});

test('each install reads its own distribution: Play the android entry, a website APK the apk one', () => {
  const answer = { android: { build: 7, fingerprint: NEW }, apk: apkEntry };
  assert.deepEqual(newerBuild(answer, play4), { distribution: 'android', build: 7 });
  assert.deepEqual(newerBuild(answer, apk3), { distribution: 'apk', build: 10, url: apkEntry.url, md5: MD5 });
  assert.deepEqual(newerBuild(answer, { ...apk3, channel: 'apk' })?.distribution, 'apk');
});

test('an apk entry without a safe address or checksum names nothing', () => {
  assert.equal(newerBuild({ apk: { ...apkEntry, url: 'http://dl.wavfeed.com/x.apk' } }, apk3), null);
  assert.equal(newerBuild({ apk: { ...apkEntry, md5: 'nope' } }, apk3), null);
});

test('an install that checks nothing, or a malformed answer, names nothing', () => {
  assert.equal(newerBuild({ ios: { build: 8, fingerprint: NEW } }, { ...ios7, channel: 'preview' }), null);
  for (const answer of [null, 'x', [], { ios: null }, { ios: { build: '8', fingerprint: NEW } }, { ios: { build: 8, fingerprint: 'nope' } }]) {
    assert.equal(newerBuild(answer, ios7), null);
  }
  assert.equal(newerBuild({ ios: { build: 8, fingerprint: NEW } }, { ...ios7, build: null }), null);
  assert.equal(newerBuild({ ios: { build: 8, fingerprint: NEW } }, { ...ios7, runtime: null }), null);
});

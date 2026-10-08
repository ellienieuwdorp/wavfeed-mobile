/** The release record read from tags (scripts/ledger.mjs, task 0065 decision 1). */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { entryOf, newest, tagMessage } from './ledger.mjs';

const RUNTIME = 'a'.repeat(40);

test('a message written for a tag reads back as the same release', () => {
  const message = tagMessage('iOS build 9, TestFlight', { Distribution: 'testflight', Build: 9, Runtime: RUNTIME, Patch: null });
  assert.deepEqual(entryOf('ios/build-9', 'c0ffee', message, '2026-10-08'), {
    kind: 'build', tag: 'ios/build-9', commit: 'c0ffee', date: '2026-10-08', distribution: 'testflight', platform: 'ios', build: 9, runtime: RUNTIME, channel: 'production',
  });
});

test('an update tag names its channel, platforms, group and patch', () => {
  const message = tagMessage('EAS Update', { Group: 'aaaabbbb-2222-3333-4444-555555555555', Runtime: RUNTIME, Rollout: 100, Patch: 'ios-7' });
  const entry = entryOf('ota/production/android+ios/2026-10-08-aaaabbbb', 'c0ffee', message, '2026-10-08');
  assert.deepEqual([entry.kind, entry.channel, entry.platforms, entry.group, entry.rollout, entry.patch], ['ota', 'production', ['android', 'ios'], 'aaaabbbb-2222-3333-4444-555555555555', 100, 'ios-7']);
});

test('an apk tag is its own distribution on android and carries its download', () => {
  const entry = entryOf('apk/build-10', 'c0ffee', tagMessage('APK', { Runtime: RUNTIME, Url: 'https://dl.wavfeed.com/android/wavfeed-10.apk', Md5: 'm', Sha256: 's', Channel: 'apk' }), '');
  assert.deepEqual([entry.distribution, entry.platform, entry.channel, entry.url, entry.md5], ['apk', 'android', 'apk', 'https://dl.wavfeed.com/android/wavfeed-10.apk', 'm']);
});

test('a tag that is not a release is no entry', () => {
  assert.equal(entryOf('v1.0.0', 'c0ffee', 'x', ''), null);
  assert.equal(entryOf('android/preview-3', 'c0ffee', 'x', ''), null);
});

test('the newest build is the highest number of that distribution', () => {
  const at = (tag) => entryOf(tag, 'c', tagMessage('x', { Runtime: RUNTIME }), '');
  const entries = [at('android/build-7'), at('apk/build-10'), at('android/build-4')];
  assert.equal(newest(entries, 'play').build, 7);
  assert.equal(newest(entries, 'apk').build, 10);
  assert.equal(newest(entries, 'testflight'), null);
});

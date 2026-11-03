/** The release record read from tags (scripts/ledger.mjs). */
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { entryOf, newest, tagMessage } from './ledger.mjs';

const RUNTIME = 'a'.repeat(40);
const SCRIPT = fileURLToPath(new URL('./ledger.mjs', import.meta.url));
const BUILD = fileURLToPath(new URL('../build/', import.meta.url));

function repository(t) {
  mkdirSync(BUILD, { recursive: true });
  const root = mkdtempSync(join(BUILD, 'ledger-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const repo = join(root, 'repo');
  const remote = join(root, 'origin.git');
  const env = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' };
  const git = (cwd, ...args) => execFileSync('git', args, { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git(root, 'init', '--bare', '--quiet', remote);
  git(root, 'init', '--quiet', repo);
  git(repo, 'config', 'user.name', 'Release test');
  git(repo, 'config', 'user.email', 'release-test@example.invalid');
  git(repo, 'config', 'tag.gpgSign', 'false');
  git(repo, 'config', 'commit.gpgSign', 'false');
  git(repo, 'commit', '--quiet', '--allow-empty', '-m', 'Source');
  git(repo, 'remote', 'add', 'origin', remote);
  return { repo, remote, env, git, cli: (...args) => spawnSync(process.execPath, [SCRIPT, ...args], { cwd: repo, env, encoding: 'utf8' }) };
}

test('a refused tag push fails the CLI, keeps the release record and resumes only its publication', (t) => {
  const { repo, remote, env, git, cli } = repository(t);
  const name = 'ios/build-9';
  const ref = `refs/tags/${name}`;
  const commit = git(repo, 'rev-parse', 'HEAD');
  git(repo, 'config', 'push.followTags', 'true');
  git(repo, 'tag', '-a', 'unrelated-tag', '-m', 'Unrelated tag');
  const hook = join(remote, 'hooks/pre-receive');
  writeFileSync(hook, '#!/bin/sh\necho "test: reject tag publication" >&2\nexit 1\n', { mode: 0o755 });
  const failed = cli('tag', name, 'iOS build 9, TestFlight', `Runtime=${RUNTIME}`);
  assert.match(failed.stderr, /test: reject tag publication/);
  assert.notEqual(failed.status, 0, 'a refused tag push must fail the release caller');
  const object = git(repo, 'rev-parse', ref);
  assert.equal(git(repo, 'cat-file', '-t', object), 'tag');
  assert.equal(git(repo, 'rev-parse', `${ref}^{commit}`), commit);
  assert.match(git(repo, 'cat-file', '-p', object), new RegExp(`Runtime: ${RUNTIME}`));
  assert.equal(git(remote, 'for-each-ref', '--format=%(objectname)', ref), '');
  const recovery = /ledger: resume tag publication only: (.+)/.exec(failed.stderr)?.[1];
  assert.ok(recovery, 'failure must give an executable tag-only recovery command');
  rmSync(hook);
  git(repo, 'commit', '--quiet', '--allow-empty', '-m', 'New source after release');
  const resumed = spawnSync('sh', ['-c', recovery], { cwd: repo, env, encoding: 'utf8' });
  assert.equal(resumed.status, 0, resumed.stderr);
  assert.equal(git(remote, 'rev-parse', ref), object);
  assert.equal(git(remote, 'rev-parse', `${ref}^{commit}`), commit);
  assert.equal(git(remote, 'for-each-ref', '--format=%(refname)', 'refs/tags'), ref);
  assert.equal(git(repo, 'rev-parse', ref), object);
  writeFileSync(hook, '#!/bin/sh\nexit 1\n', { mode: 0o755 });
  const repeated = cli('publish-tag', name);
  assert.equal(repeated.status, 0, repeated.stderr);
  assert.equal(git(remote, 'rev-parse', ref), object);
});

test('tag publication refuses a different remote annotation even when both tags name the same commit', (t) => {
  const { repo, remote, git, cli } = repository(t);
  const name = 'android/build-7';
  const ref = `refs/tags/${name}`;
  git(repo, 'tag', '-a', name, '-m', 'Remote release record');
  git(repo, 'push', '--quiet', 'origin', ref);
  const remoteObject = git(remote, 'rev-parse', ref);
  git(repo, 'tag', '-d', name);
  git(repo, 'tag', '-a', name, '-m', 'Different local release record');
  const localObject = git(repo, 'rev-parse', ref);
  assert.notEqual(localObject, remoteObject);
  const failed = cli('publish-tag', name);
  assert.notEqual(failed.status, 0, 'a conflicting release record must not pass for published');
  assert.equal(git(remote, 'rev-parse', ref), remoteObject);
  assert.equal(git(repo, 'rev-parse', ref), localObject);
});

test('a successful push is incomplete until the remote advertises the annotated tag', (t) => {
  const { repo, remote, git, cli } = repository(t);
  const name = 'apk/build-10';
  const ref = `refs/tags/${name}`;
  writeFileSync(join(remote, 'hooks/post-receive'), '#!/bin/sh\nwhile read -r old new ref; do git update-ref -d "$ref"; done\n', { mode: 0o755 });
  const failed = cli('tag', name, 'Website APK', `Runtime=${RUNTIME}`);
  assert.notEqual(failed.status, 0, 'push exit status alone does not confirm publication');
  assert.equal(git(remote, 'for-each-ref', '--format=%(objectname)', ref), '');
  assert.equal(git(repo, 'cat-file', '-t', git(repo, 'rev-parse', ref)), 'tag');
});

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

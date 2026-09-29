/// <reference types="node" />
/**
 * The pure Tally rules (task 0038): bucket edges, the screen list against the routes on disk, the sharing gate's truth
 * table, and a context the ingest Worker's patterns accept whatever the build reports.
 */
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, test } from 'node:test';

import { SCREENS, WIRE } from './catalogue';
import { buildContext, countBucket, durationBucket, gateOpen, isLocalTallyUrl, screenFor, sendEnv, type BuildFacts } from './tally';

describe('buckets', () => {
  test('counts fall into their bucket at each edge', () => {
    const cases: [number, string][] = [
      [0, '0'], [1, '1'], [2, '2 to 5'], [5, '2 to 5'], [6, '6 to 20'], [20, '6 to 20'],
      [21, '21 to 100'], [100, '21 to 100'], [101, '100+'], [-3, '0'],
    ];
    for (const [n, bucket] of cases) assert.equal(countBucket(n), bucket, `${n}`);
  });

  test('durations hold their lower edge', () => {
    const cases: [number, string][] = [
      [-5, '<1s'], [999, '<1s'], [1_000, '1 to 3s'], [2_999, '1 to 3s'], [3_000, '3 to 10s'], [10_000, '10 to 60s'],
      [59_999, '10 to 60s'], [60_000, '1 to 10m'], [599_999, '1 to 10m'], [600_000, '10m+'],
    ];
    for (const [ms, bucket] of cases) assert.equal(durationBucket(ms), bucket, `${ms} ms`);
  });
});

/** The pathname expo-router reports for each route file: groups, `index` and platform suffixes dropped. */
function routePaths(): string[] {
  const root = join(import.meta.dirname, '..', 'app');
  const files = readdirSync(root, { recursive: true, encoding: 'utf8' }).filter((f) => f.endsWith('.tsx'));
  const paths = files
    .map((file) => relative(root, join(root, file)).split(sep))
    .filter((parts) => !parts.some((part) => part.startsWith('_') || part.startsWith('+')))
    .map((parts) => {
      const segments = parts.map((part) => part.replace(/(\.(ios|android|web|native))?\.tsx$/, ''));
      const kept = segments.filter((part) => !/^\(.*\)$/.test(part) && part !== 'index');
      return `/${kept.join('/')}`;
    });
  return [...new Set(paths)];
}

describe('screenFor', () => {
  test('every route in src/app has its own screen, and every screen but other has a route', () => {
    const paths = routePaths();
    assert.ok(paths.includes('/') && paths.includes('/bought/upcoming'), paths.join(', '));
    const screens = paths.map(screenFor);
    assert.ok(!screens.includes('other'), `unmapped: ${paths.filter((p) => screenFor(p) === 'other').join(', ')}`);
    assert.equal(new Set(screens).size, screens.length);
    assert.deepEqual([...screens].sort(), SCREENS.filter((s) => s !== 'other').sort());
  });

  test('a query, a hash or a trailing slash never changes the screen, and an unknown path is other', () => {
    assert.equal(screenFor('/releases/upcoming/?item=4102938475#x'), 'releases_upcoming');
    assert.equal(screenFor('/bought-by?fans=[2214537]'), 'bought_by');
    assert.equal(screenFor('/ellie/feed'), 'other');
  });
});

const RELEASE: BuildFacts = {
  dev: false,
  devOverride: false,
  expoGo: false,
  url: 'https://tallies-ingest.example.workers.dev/v1/batch',
  key: 'wf_prod_x',
  appEnv: 'production',
};
const DEV: BuildFacts = { ...RELEASE, dev: true, devOverride: true, url: 'http://localhost:8787/v1/batch', key: 'wf_dev_local', appEnv: undefined };
const YES = { on: true, install: '3b9f0c52-8a0e-4c2f-9a41-6f1d2b7e9c10', since: 0 } as const;

describe('the sharing gate', () => {
  test('sends only from a release build to a remote Worker, or a dev bundle with the override to a local one', () => {
    const cases: [string, BuildFacts, string | null][] = [
      ['release build, preview', { ...RELEASE, appEnv: 'preview' }, 'preview'],
      ['release build, production', RELEASE, 'production'],
      ['release build with a localhost URL', { ...RELEASE, url: 'http://localhost:8787/v1/batch' }, null],
      ['release build in Expo Go', { ...RELEASE, expoGo: true }, null],
      ['release build with no app env', { ...RELEASE, appEnv: undefined }, null],
      ['release build claiming development', { ...RELEASE, appEnv: 'development' }, null],
      ['release build with no key (a self-build)', { ...RELEASE, key: undefined }, null],
      ['release build with no URL', { ...RELEASE, url: '' }, null],
      ['dev bundle with the override, local', DEV, 'development'],
      ['dev bundle with the override in Expo Go, local', { ...DEV, expoGo: true }, 'development'],
      ['dev bundle with the override and a workers.dev URL', { ...DEV, url: RELEASE.url }, null],
      ['dev bundle without the override, local', { ...DEV, devOverride: false }, null],
      ['Expo Go without the override', { ...DEV, devOverride: false, expoGo: true }, null],
    ];
    for (const [name, build, env] of cases) {
      assert.equal(sendEnv(build), env, name);
      assert.equal(gateOpen(build, YES), env !== null, name);
      assert.equal(gateOpen(build, null), false, `${name}, no yes`);
    }
  });

  test('local means localhost, the emulator host, the tailnet and ts.net, over http', () => {
    const local = ['http://localhost:8787/v1/batch', 'http://127.0.0.1:8787', 'http://10.0.2.2:8787', 'http://100.72.58.62:8787', 'https://mac.tail1234.ts.net/v1/batch'];
    const remote = ['https://tallies-ingest.example.workers.dev', 'http://100.128.0.1', 'http://100.63.0.1', 'http://localhost@evil.example', 'ftp://localhost', 'not a url', 'https://ts.net.example'];
    for (const url of local) assert.equal(isLocalTallyUrl(url), true, url);
    for (const url of remote) assert.equal(isLocalTallyUrl(url), false, url);
  });
});

describe('the batch context', () => {
  const app = { version: '1.0.0', build: '37', embedded: true, updateId: null, platform: 'ios', osVersion: '26.0.1' } as const;

  test('carries the build and a major OS version the Worker accepts', () => {
    assert.deepEqual(buildContext(app, 'production'), {
      schema: 1, version: '1.0.0', build: '37', update: 'embedded', env: 'production', platform: 'ios', os: 26,
    });
    assert.equal(buildContext({ ...app, platform: 'android', osVersion: 36 }, 'preview').os, 36);
  });

  test('names a downloaded update by its id and falls back to embedded for anything else', () => {
    const id = '0e5c4f7a-2d11-4b1e-8f3a-9b6d0c2e4a55';
    assert.equal(buildContext({ ...app, embedded: false, updateId: id }, 'production').update, id);
    assert.equal(buildContext({ ...app, embedded: false, updateId: 'not-an-id' }, 'production').update, 'embedded');
  });

  test('cleans whatever the build reports into the patterns the Worker checks', () => {
    const ctx = buildContext({ ...app, version: null, build: '1.0 (37) beta build number long', osVersion: 'n/a' }, 'preview');
    assert.match(ctx.version, WIRE.buildPattern);
    assert.match(ctx.build, WIRE.buildPattern);
    assert.ok(ctx.os >= WIRE.osMin && ctx.os <= WIRE.osMax);
  });
});

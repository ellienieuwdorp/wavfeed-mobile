/// <reference types="node" />
/**
 * The production transport's controls against stored release pages and recorded native commands (task 0070).
 * Only React hook plumbing and the native player are stood in; tracklist loading, selection, starts and Tallies
 * run their production owners. This does not render a screen or exercise native audio/event scheduling.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test, type TestContext } from 'node:test';
import vm from 'node:vm';

import type { BandcampSession } from '@/bandcamp/session';
import type { BandcampDocument } from '@/bandcamp/wire';
import { insertRawDocument } from '@/store/rawDocuments';
import * as actions from '@/tally/actions';
import type { Tally } from '@/tally/catalogue';

import { readTracklist } from '@/store/queries';

import { openTestStore } from '../../test/nodeDb';
import * as start from './start';
import * as transport from './transport';
import type { TransportTallies, useTransport } from './useTransport';

const require = createRequire(import.meta.url);
const ts = require('typescript') as typeof import('typescript');
const source = ts.transpileModule(readFileSync(new URL('./useTransport.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const RELEASE: transport.PlayableRelease = {
  itemType: 'album', itemId: '1', title: 'Upcoming', artist: 'Page',
  url: 'https://page.bandcamp.com/album/upcoming', artUrl: null, hue: 0,
};
const OLD_URI = 'https://audio.invalid/101';
const NEW_URI = 'https://audio.invalid/102';

function page(itemId = 1, fetchedAt = new Date().toISOString(), secondPlays = true, uris: readonly [string, string] = [OLD_URI, NEW_URI]): BandcampDocument {
  return {
    endpoint: 'release_page', fetchedAt,
    payload: {
      itemType: 'a', itemId, band: { id: 7 },
      tralbum: {
        current: { id: itemId, type: 'album', band_id: 7 },
        trackinfo: [
          { id: 101, track_num: 1, title: 'Earlier Drop', duration: 60, streaming: 1, file: { 'mp3-128': uris[0] } },
          { id: 102, track_num: 2, title: 'Later Drop', duration: 90, streaming: 1, file: secondPlays ? { 'mp3-128': uris[1] } : null },
        ],
      },
    },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

async function settle() {
  await new Promise<void>((done) => setImmediate(done));
}

function mount(deps: transport.TransportDeps & TransportTallies) {
  const slots: unknown[] = [];
  const effects: (() => void | (() => void))[] = [];
  const cleanups: (() => void)[] = [];
  const calls: string[] = [];
  let lockScreen = 0;
  let onStatus: ((status: Record<string, unknown>) => void) | null = null;
  let cursor = 0;
  let mounted = false;
  let refuses = false;
  const hooks = {
    useCallback: <T>(fn: T) => fn,
    useMemo: <T>(fn: () => T) => fn(),
    useRef: <T>(current: T) => {
      const at = cursor++;
      if (!mounted) slots[at] = { current };
      return slots[at];
    },
    useState: <T>(initial: T) => {
      const at = cursor++;
      if (!mounted) slots[at] = initial;
      return [slots[at], (next: T | ((before: T) => T)) => {
        slots[at] = typeof next === 'function' ? (next as (before: T) => T)(slots[at] as T) : next;
      }];
    },
    useEffect: (effect: () => void | (() => void)) => { if (!mounted) effects.push(effect); },
  };
  const audio = {
    replace: ({ uri }: { uri: string }) => { calls.push(`replace ${uri}`); },
    play: () => { calls.push('play'); if (refuses) throw new Error('Session activation failed'); },
    pause: () => { calls.push('pause'); },
    seekTo: async (seconds: number) => { calls.push(`seek ${seconds}`); },
    setActiveForLockScreen: () => { lockScreen += 1; },
    clearLockScreenControls: () => {},
    updateLockScreenMetadata: () => {},
    addListener: (_name: string, listener: (status: Record<string, unknown>) => void) => {
      onStatus = listener;
      return { remove() { onStatus = null; } };
    },
  };
  const imports: Record<string, unknown> = {
    react: hooks,
    'expo-audio': { useAudioPlayer: () => audio, setAudioModeAsync: async () => {} },
    '@/dev/sampleMode': { SAMPLE_MODE: false },
    '@/tally/actions': actions,
    './start': start, './transport': transport,
  };
  const module = { exports: {} as { useTransport: typeof useTransport } };
  vm.runInNewContext(source, {
    module, exports: module.exports, Date,
    require: (name: string) => { assert.ok(name in imports, `unexpected dependency ${name}`); return imports[name]; },
  }, { filename: 'useTransport.ts' });
  const read = () => {
    cursor = 0;
    const result = module.exports.useTransport(deps);
    if (!mounted) {
      mounted = true;
      for (const effect of effects) { const cleanup = effect(); if (cleanup) cleanups.push(cleanup); }
    }
    return result.transport;
  };
  const controls = read();
  const emit = (status: Record<string, unknown>) => onStatus?.({
    isLoaded: true, playing: true, isBuffering: false, timeControlStatus: 'playing', didJustFinish: false, duration: 90, ...status,
  });
  return { controls, read, calls, emit, lockScreen: () => lockScreen, refuse: (on: boolean) => { refuses = on; }, unmount: () => cleanups.forEach((cleanup) => cleanup()) };
}

async function rig(t: TestContext, stored: BandcampDocument | null = page()) {
  const { db, close } = await openTestStore();
  t.after(close);
  if (stored) await insertRawDocument(db, stored);
  const tallies: Tally[] = [];
  let reads = 0;
  let fetchPage: BandcampSession['fetchReleasePage'] = async () => { throw new Error('unexpected page fetch'); };
  const session = {
    fetchReleasePage: (...args: Parameters<BandcampSession['fetchReleasePage']>) => { reads += 1; return fetchPage(...args); },
  } as unknown as BandcampSession;
  const mounted = mount({ db, session, putRaw: (doc) => insertRawDocument(db, doc), track: (tally) => tallies.push(tally), screen: () => 'releases' });
  t.after(mounted.unmount);
  return { ...mounted, db, tallies, reads: () => reads, fetchWith: (fn: BandcampSession['fetchReleasePage']) => { fetchPage = fn; } };
}

test('a later Drop selects its native stream; current-target and ordinary artwork presses still toggle', async (t) => {
  const at = await rig(t);
  at.controls.play(RELEASE, '101');
  await settle();
  assert.equal(at.read().track?.trackId, '101');
  assert.equal(at.calls.at(-2), `replace ${OLD_URI}`);
  at.controls.play(RELEASE, '102');
  await settle();
  assert.equal(at.calls.at(-2), `replace ${NEW_URI}`, 'the explicit later Drop must reach the native player');
  assert.equal(at.read().track?.trackId, '102');
  assert.equal(at.read().playing, true);
  const replacements = at.calls.filter((call) => call.startsWith('replace'));
  at.controls.play(RELEASE, '102');
  assert.equal(at.calls.at(-1), 'pause');
  assert.equal(at.read().playing, false);
  at.controls.play(RELEASE);
  assert.equal(at.calls.at(-1), 'play');
  assert.equal(at.read().playing, true);
  at.controls.play(RELEASE);
  assert.equal(at.calls.at(-1), 'pause');
  assert.deepEqual(at.calls.filter((call) => call.startsWith('replace')), replacements);
  assert.equal(at.reads(), 0);
  assert.equal(at.tallies.filter((tally) => tally.name === 'playback_started').length, 1);
});

test('the latest explicit Drop target survives a pending load and an ordinary artwork press', async (t) => {
  const at = await rig(t, null);
  const pending = deferred<Awaited<ReturnType<BandcampSession['fetchReleasePage']>>>();
  at.fetchWith(() => pending.promise);
  at.controls.play(RELEASE, '101');
  await settle();
  at.controls.play(RELEASE, '102');
  at.controls.play(RELEASE);
  assert.equal(at.read().status, 'loading');
  assert.equal(at.reads(), 1);
  pending.resolve({ kind: 'ok', value: { kind: 'page', document: page() } });
  await settle();
  assert.deepEqual(at.calls.filter((call) => call.startsWith('replace')), [`replace ${NEW_URI}`]);
  assert.equal(at.read().track?.trackId, '102');
  assert.equal(at.read().playing, true);
  assert.equal(at.reads(), 1);
});

test('a target missing from a pending load gets one fresh read before selection or fallback', async (t) => {
  for (const scenario of [
    { name: 'later Drop and refused start', latest: '102', secondPlays: true, refuses: true, expected: NEW_URI },
    { name: 'target changes during fresh read', latest: '101', secondPlays: true, refuses: false, expected: OLD_URI },
    { name: 'fresh page still has no target stream', latest: '102', secondPlays: false, refuses: false, expected: OLD_URI },
  ]) {
    await t.test(scenario.name, async (t) => {
      const at = await rig(t, null);
      const initial = deferred<Awaited<ReturnType<BandcampSession['fetchReleasePage']>>>();
      const fresh = deferred<Awaited<ReturnType<BandcampSession['fetchReleasePage']>>>();
      at.fetchWith(() => {
        if (at.reads() === 1) return initial.promise;
        if (at.reads() === 2) return fresh.promise;
        throw new Error('unexpected extra page read');
      });
      at.controls.play(RELEASE, '101');
      await settle();
      at.controls.play(RELEASE, '102');
      initial.resolve({ kind: 'ok', value: { kind: 'page', document: page(1, new Date().toISOString(), false) } });
      await settle();
      assert.equal(at.reads(), 2, 'the stale initial list must trigger one fresh page read');
      assert.equal(at.read().status, 'loading');
      assert.deepEqual(at.calls.filter((call) => call.startsWith('replace')), []);
      at.controls.play(RELEASE, scenario.latest);
      at.controls.play(RELEASE);
      at.refuse(scenario.refuses);
      fresh.resolve({ kind: 'ok', value: { kind: 'page', document: page(1, new Date().toISOString(), scenario.secondPlays) } });
      await settle();
      assert.deepEqual(at.calls.filter((call) => call.startsWith('replace')), [`replace ${scenario.expected}`]);
      assert.equal(at.read().playing, !scenario.refuses);
      assert.equal(at.reads(), 2);
      const started = at.tallies.filter((tally) => tally.name === 'playback_started');
      assert.equal(started.length, 1);
      assert.equal(started[0]?.props.retried, false);
      assert.equal(started[0]?.props.result, scenario.refuses ? 'refused' : 'playing');
      if (scenario.refuses) {
        at.refuse(false);
        at.controls.play(RELEASE, '102');
        assert.equal(at.read().playing, true);
        assert.equal(at.tallies.filter((tally) => tally.name === 'playback_started').length, 1);
      }
    });
  }
});

test('a newer Release retires the fresh read for an earlier pending target', async (t) => {
  const at = await rig(t, null);
  const initial = deferred<Awaited<ReturnType<BandcampSession['fetchReleasePage']>>>();
  const fresh = deferred<Awaited<ReturnType<BandcampSession['fetchReleasePage']>>>();
  at.fetchWith((_url, key) => {
    if (key.itemId === 2) return Promise.resolve({ kind: 'ok', value: { kind: 'page', document: page(2) } });
    return at.reads() === 1 ? initial.promise : fresh.promise;
  });
  at.controls.play(RELEASE, '101');
  await settle();
  at.controls.play(RELEASE, '102');
  initial.resolve({ kind: 'ok', value: { kind: 'page', document: page(1, new Date().toISOString(), false) } });
  await settle();
  assert.equal(at.read().status, 'loading');
  assert.equal(at.reads(), 2);
  at.controls.play({ ...RELEASE, itemId: '2' }, '101');
  await settle();
  fresh.resolve({ kind: 'ok', value: { kind: 'page', document: page() } });
  await settle();
  assert.deepEqual(at.calls.filter((call) => call.startsWith('replace')), [`replace ${OLD_URI}`]);
  assert.equal(at.read().release?.itemId, '2');
  assert.equal(at.read().playing, true);
  assert.equal(at.tallies.filter((tally) => tally.name === 'playback_started').length, 1);
});

test('a failed fresh read settles the pending target with one error Tally', async (t) => {
  const at = await rig(t, null);
  const initial = deferred<Awaited<ReturnType<BandcampSession['fetchReleasePage']>>>();
  const fresh = deferred<void>();
  at.fetchWith(async () => {
    if (at.reads() === 1) return initial.promise;
    await fresh.promise;
    throw new Error('page read failed');
  });
  at.controls.play(RELEASE, '101');
  await settle();
  at.controls.play(RELEASE, '102');
  initial.resolve({ kind: 'ok', value: { kind: 'page', document: page(1, new Date().toISOString(), false) } });
  await settle();
  assert.equal(at.read().status, 'loading');
  assert.equal(at.reads(), 2);
  fresh.resolve();
  await settle();
  assert.equal(at.read().status, 'error');
  assert.equal(at.read().playing, false);
  assert.deepEqual(at.calls.filter((call) => call.startsWith('replace')), []);
  const started = at.tallies.filter((tally) => tally.name === 'playback_started');
  assert.equal(started.length, 1);
  assert.equal(started[0]?.props.result, 'error');
  assert.equal(started[0]?.props.retried, false);
});

test('a Drop missing its stream reloads the page and starts the newly available Track', async (t) => {
  const at = await rig(t, page(1, new Date().toISOString(), false));
  at.controls.play(RELEASE, '101');
  await settle();
  at.fetchWith(async () => ({ kind: 'ok', value: { kind: 'page', document: page() } }));
  at.controls.play(RELEASE, '102');
  await settle();
  assert.equal(at.calls.at(-2), `replace ${NEW_URI}`);
  assert.equal(at.read().track?.trackId, '102');
  assert.equal(at.reads(), 1);
  const started = at.tallies.filter((tally) => tally.name === 'playback_started');
  assert.equal(started.length, 2);
  assert.equal(started[1]?.props.retried, true);
});

test('a targeted start refused by the audio session stays paused and resumes without another load or start Tally', async (t) => {
  const at = await rig(t);
  at.controls.play(RELEASE, '101');
  await settle();
  at.refuse(true);
  at.controls.play(RELEASE, '102');
  await settle();
  assert.equal(at.calls.at(-2), `replace ${NEW_URI}`);
  assert.equal(at.read().status, 'ready');
  assert.equal(at.read().track?.trackId, '102');
  assert.equal(at.read().playing, false);
  at.controls.play(RELEASE, '102');
  assert.equal(at.read().playing, false);
  at.refuse(false);
  at.controls.play(RELEASE, '102');
  assert.equal(at.read().playing, true);
  assert.equal(at.reads(), 0);
  assert.equal(at.tallies.filter((tally) => tally.name === 'playback_started').length, 1);
});

test('an explicit Drop after URL expiry reloads its target and reports a refused retry once', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
  const at = await rig(t);
  at.controls.play(RELEASE, '101');
  await settle();
  t.mock.timers.tick(25 * 60 * 60_000);
  const refreshed = `${NEW_URI}?token=renewed`;
  at.fetchWith(async () => ({ kind: 'ok', value: { kind: 'page', document: page(1, new Date().toISOString(), true, [OLD_URI, refreshed]) } }));
  at.refuse(true);
  at.controls.play(RELEASE, '102');
  await settle();
  assert.equal(at.calls.at(-2), `replace ${refreshed}`);
  assert.equal(at.read().status, 'ready');
  assert.equal(at.read().track?.trackId, '102');
  assert.equal(at.read().playing, false);
  assert.equal(at.reads(), 1);
  const started = at.tallies.filter((tally) => tally.name === 'playback_started');
  assert.equal(started.length, 2);
  assert.equal(started[1]?.props.retried, true);
  assert.equal(started[1]?.props.result, 'refused');
  at.refuse(false);
  at.controls.play(RELEASE, '102');
  assert.equal(at.calls.at(-1), 'play');
  assert.equal(at.read().playing, true);
  assert.equal(at.tallies.filter((tally) => tally.name === 'playback_started').length, 2);
});

test('a newer Release retires a pending targeted load before its native start', async (t) => {
  const at = await rig(t, null);
  const pending = deferred<Awaited<ReturnType<BandcampSession['fetchReleasePage']>>>();
  at.fetchWith((_url, key) => key.itemId === 1 ? pending.promise : Promise.resolve({ kind: 'ok', value: { kind: 'page', document: page(2) } }));
  at.controls.play(RELEASE, '101');
  await settle();
  at.controls.play(RELEASE, '102');
  at.controls.play({ ...RELEASE, itemId: '2' }, '101');
  await settle();
  pending.resolve({ kind: 'ok', value: { kind: 'page', document: page() } });
  await settle();
  assert.deepEqual(at.calls.filter((call) => call.startsWith('replace')), [`replace ${OLD_URI}`]);
  assert.equal(at.read().release?.itemId, '2');
  assert.equal(at.read().track?.trackId, '101');
  assert.equal(at.read().playing, true);
});

/** A launch's restore of `RELEASE` at its second Track, 30 seconds in, off the page stored in the rig (task 0071, Open 13). */
async function restored(at: Awaited<ReturnType<typeof rig>>) {
  const tracklist = await readTracklist(at.db, 'a', 1);
  assert.ok(tracklist);
  at.controls.restore({ release: RELEASE, tracklist, index: 1, position: 30 });
}

test('a restored Release touches no audio until play, which starts its Track where it was left or moved to', async (t) => {
  const at = await rig(t);
  await restored(at);
  assert.equal(at.read().track?.trackId, '102');
  assert.equal(at.read().status, 'ready');
  assert.equal(at.read().playing, false);
  assert.deepEqual(at.calls, [], 'no stream and no session before a press');
  at.controls.seek(50);
  assert.deepEqual(at.calls, []);
  assert.equal(at.lockScreen(), 0, 'nothing on the lock screen before a press');
  at.controls.toggle();
  assert.equal(at.lockScreen(), 1);
  assert.deepEqual(at.calls, [`replace ${NEW_URI}`, 'seek 50', 'play']);
  assert.equal(at.read().playing, true);
  assert.equal(at.reads(), 0);
  const started = at.tallies.filter((tally) => tally.name === 'playback_started');
  assert.deepEqual(started.map((tally) => tally.props.result), ['playing']);
  at.controls.toggle();
  at.controls.toggle();
  assert.deepEqual(at.calls.slice(-2), ['pause', 'play'], 'once started it pauses and resumes in place');
});

test('a restore never replaces a Release already in the transport', async (t) => {
  const at = await rig(t);
  at.controls.play(RELEASE, '101');
  await settle();
  await restored(at);
  assert.equal(at.read().track?.trackId, '101');
  assert.equal(at.read().playing, true);
});

test('a restored Release whose stream URLs expired reads its page afresh, then starts at the saved position', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
  const at = await rig(t);
  await restored(at);
  t.mock.timers.tick(25 * 60 * 60_000);
  const refreshed = `${NEW_URI}?token=renewed`;
  at.fetchWith(async () => ({ kind: 'ok', value: { kind: 'page', document: page(1, new Date().toISOString(), true, [OLD_URI, refreshed]) } }));
  at.controls.toggle();
  await settle();
  assert.deepEqual(at.calls.slice(-3), [`replace ${refreshed}`, 'seek 30', 'play']);
  assert.equal(at.read().playing, true);
  assert.equal(at.reads(), 1);
  const started = at.tallies.filter((tally) => tally.name === 'playback_started');
  assert.deepEqual(started.map((tally) => tally.props.retried), [false], 'the first press on a restore is no retry');
});

test('a retry after a failed fresh read starts the restored Track where it was left', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
  const at = await rig(t);
  await restored(at);
  t.mock.timers.tick(25 * 60 * 60_000);
  at.fetchWith(async () => { throw new Error('offline'); });
  at.controls.toggle();
  await settle();
  assert.equal(at.read().status, 'error');
  assert.deepEqual(at.calls.filter((call) => call.startsWith('replace')), []);
  const refreshed = `${NEW_URI}?token=renewed`;
  at.fetchWith(async () => ({ kind: 'ok', value: { kind: 'page', document: page(1, new Date().toISOString(), true, [OLD_URI, refreshed]) } }));
  // The mini player's "Try again" press, which names no Track in the error state.
  at.controls.play(RELEASE, at.read().track?.trackId ?? null);
  await settle();
  assert.equal(at.read().track?.trackId, '102');
  assert.deepEqual(at.calls.slice(-3), [`replace ${refreshed}`, 'seek 30', 'play']);
  const started = at.tallies.filter((tally) => tally.name === 'playback_started');
  assert.deepEqual(started.map((tally) => [tally.props.result, tally.props.retried]), [['error', false], ['playing', true]]);
});

test('a seek before a restored stream loads is not pulled back to the saved position', async (t) => {
  const at = await rig(t);
  await restored(at);
  at.controls.toggle();
  at.controls.seek(70);
  at.emit({ currentTime: 70 });
  assert.deepEqual(at.calls, [`replace ${NEW_URI}`, 'seek 30', 'play', 'seek 70']);
});

test('forgetting empties the transport and stops what plays', async (t) => {
  const at = await rig(t);
  at.controls.play(RELEASE, '101');
  await settle();
  at.controls.forget();
  assert.equal(at.read().release, null);
  assert.equal(at.read().playing, false);
  assert.equal(at.calls.at(-1), 'pause');
});

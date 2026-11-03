/// <reference types="node" />
/**
 * The last-played Release across launches as the player provider keeps it: a pause or leaving
 * the foreground saves where the Release was, the next launch restores it there, and a change of Fan empties the
 * player and restores nothing of the other Fan's. Only React's hooks, AppState and the transport are stood in; the
 * saves and the restore read a real store through `resume.ts`.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test, type TestContext } from 'node:test';
import vm from 'node:vm';
import type { SQLiteDatabase } from 'expo-sqlite';

import { insertRawDocument } from '@/store/rawDocuments';

import { FAN_ID, ITEM_ID, OTHER_FAN_ID, releasePagePayload } from '../../test/fixtures';
import { openTestStore } from '../../test/nodeDb';
import * as resume from './resume';
import type { PlayableRelease } from './transport';
import type { useResume } from './useResume';
import type { PlayerClock, Transport } from './useTransport';

const require = createRequire(import.meta.url);
const ts = require('typescript') as typeof import('typescript');
const source = ts.transpileModule(readFileSync(new URL('./useResume.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

const RELEASE: PlayableRelease = {
  itemType: 'album', itemId: String(ITEM_ID), title: 'Slow Harbour', artist: 'Nightgraft',
  url: 'https://nightgraft.bandcamp.com/album/slow-harbour', artUrl: null, hue: 210, label: null,
};
/** The fixture page's second Track, 402.1 seconds long. */
const SECOND = '55501123';

type Player = Pick<Transport, 'status' | 'release' | 'index' | 'playing' | 'track'>;
const IDLE: Player = { status: 'idle', release: null, index: null, playing: false, track: null };

function playing(on: boolean): Player {
  return { status: 'ready', release: RELEASE, index: 1, playing: on, track: { trackId: SECOND } as Transport['track'] };
}

async function store(t: TestContext): Promise<SQLiteDatabase> {
  const { db, close } = await openTestStore();
  t.after(close);
  await db.runAsync(
    `insert into releases (item_type, item_id, band_id, title, url, first_seen_at, last_seen_at)
     values ('a', ?, 1, 'Slow Harbour', ?, '2026-10-01', '2026-10-01')`,
    [ITEM_ID, RELEASE.url],
  );
  await insertRawDocument(db, { endpoint: 'release_page', payload: releasePagePayload(), fetchedAt: '2026-10-15T09:00:00.000Z' });
  return db;
}

async function settle() {
  for (let i = 0; i < 5; i += 1) await new Promise<void>((done) => setImmediate(done));
}

/** One launch: the hook mounted once, re-rendered with each `render`, its effects run when their deps change. */
function launch(t: TestContext, db: SQLiteDatabase, fanId: number | null) {
  const slots: unknown[] = [];
  const effects: { deps: readonly unknown[] | undefined; cleanup: (() => void) | undefined }[] = [];
  const pending: { at: number; effect: () => void | (() => void); deps: readonly unknown[] | undefined }[] = [];
  let cursor = 0;
  let effectCursor = 0;
  let mounted = false;
  let toForeground: ((next: string) => void) | null = null;
  const restored: resume.Resume[] = [];
  let forgotten = 0;
  const slot = <T>(initial: () => T): { current: T } => {
    const at = cursor++;
    if (!mounted) slots[at] = { current: initial() };
    return slots[at] as { current: T };
  };
  const hooks = {
    useRef: <T>(current: T) => slot(() => current),
    useState: <T>(initial: T | (() => T)) => {
      const held = slot(() => (typeof initial === 'function' ? (initial as () => T)() : initial));
      return [held.current, (next: T) => { held.current = next; }];
    },
    useEffectEvent: <F extends (...args: never[]) => unknown>(fn: F) => {
      const latest = slot(() => ({ fn, call: (...args: never[]) => latest.current.fn(...args) }));
      latest.current.fn = fn;
      return latest.current.call;
    },
    useEffect: (effect: () => void | (() => void), deps?: readonly unknown[]) => {
      const at = effectCursor++;
      const before = effects[at];
      if (before === undefined || deps === undefined || before.deps === undefined || deps.some((dep, n) => !Object.is(dep, before.deps?.[n]))) {
        pending.push({ at, effect, deps });
      }
    },
  };
  const AppState = {
    addEventListener: (_name: string, listener: (next: string) => void) => {
      toForeground = listener;
      return { remove() { toForeground = null; } };
    },
  };
  const module = { exports: {} as { useResume: typeof useResume } };
  vm.runInNewContext(source, {
    module, exports: module.exports, setTimeout, clearTimeout, setInterval, clearInterval,
    require: (name: string) => {
      const imports: Record<string, unknown> = { react: hooks, 'react-native': { AppState }, './resume': resume };
      assert.ok(name in imports, `unexpected dependency ${name}`);
      return imports[name];
    },
  }, { filename: 'useResume.ts' });

  const restore = (r: resume.Resume) => { restored.push(r); };
  const forget = () => { forgotten += 1; };
  let ready = false;
  const render = (player: Player, clock: PlayerClock, fan: number | null = fanId) => {
    cursor = 0;
    effectCursor = 0;
    ready = module.exports.useResume({ ...player, restore, forget } as Transport, clock, db, fan);
    mounted = true;
    for (const { at, effect, deps } of pending.splice(0)) {
      effects[at]?.cleanup?.();
      effects[at] = { deps, cleanup: effect() ?? undefined };
    }
    return ready;
  };
  const unmount = () => {
    for (const effect of effects) effect.cleanup?.();
    effects.length = 0;
  };
  t.after(unmount);
  return {
    render, unmount, restored, forgotten: () => forgotten,
    leaveForeground: () => toForeground?.('background'),
  };
}

const AT_REST: PlayerClock = { position: 0, duration: 0 };

test('a pause saves where the Release was, and the next launch restores it there, paused', async (t) => {
  const db = await store(t);
  const first = launch(t, db, FAN_ID);
  first.render(IDLE, AT_REST);
  await settle();
  assert.equal(first.render(IDLE, AT_REST), true);
  assert.deepEqual(first.restored, []);
  first.render(playing(true), { position: 50, duration: 402.1 });
  first.render(playing(false), { position: 123.4, duration: 402.1 });
  await settle();
  first.unmount();

  const next = launch(t, db, FAN_ID);
  assert.equal(next.render(IDLE, AT_REST), false, 'the chrome waits for the restore read');
  await settle();
  assert.equal(next.render(IDLE, AT_REST), true);
  assert.deepEqual(next.restored.map((r) => [r.release, r.index, r.position]), [[RELEASE, 1, 123.4]]);
});

test('leaving the foreground while playing saves the position the clock has reached', async (t) => {
  const db = await store(t);
  const first = launch(t, db, FAN_ID);
  first.render(IDLE, AT_REST);
  await settle();
  first.render(IDLE, AT_REST);
  first.render(playing(true), { position: 10, duration: 402.1 });
  await settle();
  first.render(playing(true), { position: 95.2, duration: 402.1 });
  first.leaveForeground();
  await settle();
  first.unmount();

  const next = launch(t, db, FAN_ID);
  next.render(IDLE, AT_REST);
  await settle();
  next.render(IDLE, AT_REST);
  assert.deepEqual(next.restored.map((r) => r.position), [95.2]);
});

test("a change of Fan empties the player, and the other Fan's launch restores nothing", async (t) => {
  const db = await store(t);
  const first = launch(t, db, FAN_ID);
  first.render(IDLE, AT_REST);
  await settle();
  first.render(IDLE, AT_REST);
  first.render(playing(false), { position: 40, duration: 402.1 });
  await settle();
  assert.equal(first.forgotten(), 0);
  first.render(playing(false), { position: 40, duration: 402.1 }, OTHER_FAN_ID);
  assert.equal(first.forgotten(), 1);
  first.unmount();

  const other = launch(t, db, OTHER_FAN_ID);
  other.render(IDLE, AT_REST);
  await settle();
  assert.equal(other.render(IDLE, AT_REST), true);
  assert.deepEqual(other.restored, []);
});

/// <reference types="node" />
/**
 * Both production New releases screens, their clock and live-query hook over a real SQLite store (task 0070).
 * React hook scheduling and native elements are stood in; classification, query invalidation and displayed list
 * data run their production owners. This does not render native rows or exercise background timer delivery.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import vm from 'node:vm';
import type { SQLiteDatabase } from 'expo-sqlite';

import * as copy from '@/copy';
import * as dates from '@/lib/dates';
import * as weekSections from '@/lib/weekSections';
import { fold, insertRawDocument, readNewReleases } from '@/store';

import { feedPayload, PREORDER_ITEM_ID, PREORDER_URL, preorderNrEntry, preorderTralbumBlob, releasePagePayload } from '../../test/fixtures';
import { openTestStore } from '../../test/nodeDb';

const require = createRequire(import.meta.url);
const ts = require('typescript') as typeof import('typescript');
type Element = { readonly props: { readonly data: readonly Item[] } };
type Item = { readonly kind: string; readonly key: string; readonly day?: string; readonly cards?: readonly { readonly day: string }[] };
type Slot = { value?: unknown; deps?: readonly unknown[]; cleanup?: () => void };

function load(file: string, imports: Record<string, unknown>) {
  const source = ts.transpileModule(readFileSync(new URL(file, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const module = { exports: {} as Record<string, unknown> };
  vm.runInNewContext(source, {
    module, exports: module.exports, Date, setInterval, clearInterval, setTimeout, clearTimeout,
    require: (name: string) => { assert.ok(name in imports, `unexpected dependency ${name}`); return imports[name]; },
  }, { filename: file });
  return module.exports;
}

function mount(file: string, db: SQLiteDatabase) {
  const slots: Slot[] = [];
  let cursor = 0;
  let dirty = true;
  let pending: (() => void)[] = [];
  let result: Element;
  const slot = () => slots[cursor++] ?? (slots[cursor - 1] = {});
  const changes = (before: readonly unknown[] | undefined, next: readonly unknown[]) => before === undefined || before.length !== next.length || next.some((value, i) => !Object.is(value, before[i]));
  const hooks = {
    createContext: () => ({}),
    useContext: () => ({ db, version: 0 }),
    useState: (initial: unknown) => {
      const at = slot();
      if (!('value' in at)) at.value = typeof initial === 'function' ? initial() : initial;
      return [at.value, (next: unknown) => {
        const value = typeof next === 'function' ? next(at.value) : next;
        if (!Object.is(value, at.value)) { at.value = value; dirty = true; }
      }];
    },
    useMemo: (fn: () => unknown, deps: readonly unknown[]) => {
      const at = slot();
      if (changes(at.deps, deps)) { at.value = fn(); at.deps = deps; }
      return at.value;
    },
    useEffect: (effect: () => void | (() => void), deps: readonly unknown[]) => {
      const at = slot();
      if (!changes(at.deps, deps)) return;
      at.deps = deps;
      pending.push(() => { at.cleanup?.(); at.cleanup = effect() || undefined; });
    },
    useEffectEvent: (fn: (...args: unknown[]) => unknown) => {
      const at = slot();
      at.value = fn;
      return (...args: unknown[]) => (at.value as typeof fn)(...args);
    },
  };
  const jsx = { jsx: (type: unknown, props: Element['props']) => ({ type, props }), jsxs: (type: unknown, props: Element['props']) => ({ type, props }) };
  const state = load('./appState.tsx', {
    react: hooks, 'react/jsx-runtime': jsx, 'expo-router': { useIsFocused: () => true },
    '@/bandcamp/session': {}, '@/bandcamp/wire': {}, '@/components/Failed': {}, '@/components/Replaying': {},
    '@/domain/endpoints': {}, '@/fetcher/sink': {}, '@/store': {}, '@/tally/errors': { reportCode: () => assert.fail('query failed') },
    '@/wishlist/membership': {}, './gatherSink': {},
  });
  const clock = load('../lib/useNow.ts', { react: hooks });
  const screen = load(file, {
    react: hooks, 'react/jsx-runtime': jsx, 'react-native': { FlatList: 'FlatList', RefreshControl: 'RefreshControl' },
    '@/components/AppBar': { useAppBar: () => ({ scroll: {} }), useAppBarAtRest: () => {} },
    '@/components/EmptyState': {}, '@/components/GapRow': {}, '@/components/player/Dock': { useDockClearance: () => 0 },
    '@/components/ReleaseRow': { ROW_LIST: {} }, '@/components/ScreenHeader': {}, '@/components/UpcomingShelf': {}, '@/components/WeekHead': {},
    '@/copy': copy, '@/lib/dates': dates, '@/lib/useNow': clock, '@/lib/weekSections': weekSections, '@/state/appState': state,
    '@/state/refresh': { useRefresh: () => ({ refreshing: false, onRefresh: () => {} }) },
    '@/store': { readNewReleases }, '@/theme/tokens': { useTokens: () => ({ c: {} }) },
  });
  const render = () => {
    while (dirty) {
      dirty = false;
      cursor = 0;
      result = (screen.default as () => Element)();
      const effects = pending;
      pending = [];
      for (const effect of effects) effect();
    }
  };
  return {
    read: async () => {
      render();
      await new Promise<void>((done) => setImmediate(done));
      render();
      return result.props.data;
    },
    unmount: () => slots.forEach((at) => at.cleanup?.()),
  };
}

for (const file of ['../app/(tabs)/releases/index.tsx', '../app/(tabs)/releases/upcoming.tsx']) {
  test(`${file}: offline clock ticks update local labels and release the shelf at GMT midnight`, async (t) => {
    const previousTZ = process.env.TZ;
    process.env.TZ = 'Europe/Amsterdam';
    t.after(() => { if (previousTZ === undefined) delete process.env.TZ; else process.env.TZ = previousTZ; });
    // Start just before local midnight; the release day is still ahead in GMT at local 00:00.
    t.mock.timers.enable({ apis: ['Date', 'setInterval'], now: Date.parse('2026-10-12T21:59:59.000Z') });
    const { db, close } = await openTestStore();
    t.after(close);
    await insertRawDocument(db, {
      endpoint: 'fan_dash_feed_updates', payload: feedPayload({ entries: [preorderNrEntry()] }), fetchedAt: '2026-09-29T10:00:00.000Z',
    });
    await insertRawDocument(db, {
      endpoint: 'release_page', payload: releasePagePayload({ itemId: PREORDER_ITEM_ID, itemUrl: PREORDER_URL, tralbum: preorderTralbumBlob() }), fetchedAt: '2026-09-29T10:05:00.000Z',
    });
    await fold(db);
    const at = mount(file, db);
    t.after(at.unmount);
    const label = (items: readonly Item[]) => file.endsWith('/index.tsx') ? items.find((item) => item.kind === 'shelf')?.cards?.[0]?.day : items.find((item) => item.key === `a:${PREORDER_ITEM_ID}`)?.day;
    assert.equal(label(await at.read()), 'Tue 13');
    t.mock.timers.tick(30_000);
    assert.equal(label(await at.read()), 'Today', 'labels follow local midnight while the Release remains Upcoming');
    t.mock.timers.tick(7_170_000);
    assert.equal(new Date().getHours(), 1);
    assert.equal(new Date().getUTCDate(), 12);
    assert.equal(label(await at.read()), 'Today');
    t.mock.timers.tick(30_000);
    assert.equal(new Date().getHours(), 2);
    assert.equal(new Date().getUTCDate(), 13);
    const items = await at.read();
    if (file.endsWith('/index.tsx')) {
      assert.equal(items.some((item) => item.kind === 'shelf'), false, 'GMT midnight removes the Upcoming shelf without a store change');
      assert.equal(items.some((item) => item.kind === 'release' && item.key === `item:a:${PREORDER_ITEM_ID}`), true, 'the released weeks receive the held Release');
    } else {
      assert.equal(items.map((item) => item.kind).join(','), 'empty', 'GMT midnight removes the Release from the full Upcoming list');
    }
  });
}

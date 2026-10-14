/// <reference types="node" />
/**
 * Both production New releases screens, their clock, provider and live-query hook over a real SQLite store (tasks 0070 and 0072).
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
import * as store from '@/store';
import { fold, insertRawDocument, readNewReleases } from '@/store';
import * as endpoints from '@/domain/endpoints';
import * as releaseFilter from '@/domain/releaseFilter';
import { CRUMBS_PAGE_ENDPOINT, type BandcampDocument } from '@/bandcamp/wire';
import { EMPTY_GATHER_STATE } from '@/fetcher/sink';

import { BAND_ID, bandDetailsPayload, discographyItem, feedPayload, followingBandsFirstPage, PREORDER_ITEM_ID, PREORDER_URL, preorderNrEntry, preorderTralbumBlob, releasePagePayload } from '../../test/fixtures';
import { openTestStore } from '../../test/nodeDb';
import { countForProjection } from '../store/rawDocuments';
import type { AppState } from './appState';
import * as filterSettings from './filterSettings';
import type { FilterSettings } from './filterSettings';
import * as gatherSink from './gatherSink';

const require = createRequire(import.meta.url);
const ts = require('typescript') as typeof import('typescript');
type Element = { readonly props: { readonly data: readonly Item[] } };
type Item = { readonly kind: string; readonly key: string; readonly day?: string; readonly heardDay?: string; readonly tracksOut?: number | null; readonly numTracks?: number | null; readonly cards?: readonly { readonly day: string; readonly out: string }[] };
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

/** The filter's store and the route's params, as New releases reads them (task 0071, decisions 5 to 9 and Open 8). */
type FilterRig = { settings: FilterSettings | null; params: { people?: string }; updates: FilterSettings[] };

function mount(file: string, db: SQLiteDatabase, provider = false, filter: FilterRig = { settings: null, params: {}, updates: [] }) {
  const screenSlots: Slot[] = [];
  const providerSlots: Slot[] = [];
  let slots = screenSlots;
  const context = { Provider: Symbol('AppStateProvider') };
  let contextValue: AppState | null = null;
  let focused = true;
  let cursor = 0;
  let dirty = true;
  let pending: (() => void)[] = [];
  let result: Element;
  const slot = () => slots[cursor++] ?? (slots[cursor - 1] = {});
  const changes = (before: readonly unknown[] | undefined, next: readonly unknown[]) => before === undefined || before.length !== next.length || next.some((value, i) => !Object.is(value, before[i]));
  const hooks = {
    createContext: () => context,
    useContext: () => provider ? contextValue : ({ db, version: 0 }),
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
    useCallback: (fn: unknown, deps: readonly unknown[]) => hooks.useMemo(() => fn, deps),
    useRef: (initial: unknown) => {
      const at = slot();
      if (!('value' in at)) at.value = { current: initial };
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
  const element = (type: unknown, props: Element['props'] & { value?: AppState }) => {
    if (type === context.Provider) contextValue = props.value ?? null;
    return { type, props };
  };
  const jsx = { jsx: element, jsxs: element };
  const state = load('./appState.tsx', {
    react: hooks, 'react/jsx-runtime': jsx, 'expo-router': { useIsFocused: () => focused },
    '@/bandcamp/session': { BandcampSession: class {} }, '@/bandcamp/wire': { CRUMBS_PAGE_ENDPOINT }, '@/components/Failed': {}, '@/components/Replaying': {},
    '@/domain/endpoints': endpoints, '@/fetcher/sink': { EMPTY_GATHER_STATE }, '@/store': { ...store, openStore: async () => ({ db }) },
    '@/tally/errors': { reportCode: () => assert.fail('query failed'), errorReports: { setSink: () => {} } },
    '@/wishlist/membership': {}, './gatherSink': gatherSink,
  });
  const clock = load('../lib/useNow.ts', { react: hooks });
  const screen = load(file, {
    react: hooks, 'react/jsx-runtime': jsx, 'react-native': { FlatList: 'FlatList', RefreshControl: 'RefreshControl' },
    'expo-router': {
      useLocalSearchParams: () => filter.params,
      useNavigation: () => ({ setParams: (params: { people?: string }) => { filter.params = { ...filter.params, ...params }; dirty = true; } }),
    },
    '@/components/filter/NothingMatches': {}, '@/domain/releaseFilter': releaseFilter, '@/state/filterSettings': filterSettings,
    '@/state/releaseFilter': {
      useReleaseFilter: () => ({ loaded: true, settings: filter.settings, filtered: null, update: (next: FilterSettings) => { filter.updates.push(next); filter.settings = next; dirty = true; } }),
      publishFiltered: () => {},
    },
    '@/components/AppBar': { useAppBar: () => ({ scroll: {} }), useAppBarAtRest: () => {} },
    '@/components/EmptyState': {}, '@/components/GapRow': {}, '@/components/player/Dock': { useDockClearance: () => 0 },
    '@/components/ReleaseRow': { ROW_LIST: {} }, '@/components/ScreenHeader': {}, '@/components/UpcomingShelf': {}, '@/components/WeekHead': {},
    '@/copy': copy, '@/lib/dates': dates, '@/lib/useNow': clock, '@/lib/weekSections': weekSections, '@/state/appState': state,
    '@/state/refresh': { useRefresh: () => ({ refreshing: false, onRefresh: () => {} }) },
    '@/store': { readNewReleases }, '@/theme/tokens': { useTokens: () => ({ c: {} }) },
  });
  const render = () => {
    let renders = 0;
    while (dirty) {
      assert.ok(renders++ < 30, 'hook state must settle');
      dirty = false;
      if (provider) {
        slots = providerSlots;
        cursor = 0;
        (state.AppStateProvider as (props: { children: null }) => unknown)({ children: null });
      }
      slots = screenSlots;
      cursor = 0;
      if (!provider || contextValue !== null) result = (screen.default as () => Element)();
      const effects = pending;
      pending = [];
      for (const effect of effects) effect();
    }
  };
  return {
    /** Draws again on the next read, as a changed route param would. */
    touch: () => { dirty = true; },
    read: async () => {
      render();
      await new Promise<void>((done) => setImmediate(done));
      render();
      await new Promise<void>((done) => setImmediate(done));
      render();
      return result.props.data;
    },
    app: () => { assert.ok(contextValue); return contextValue; },
    focus: (on: boolean) => { focused = on; dirty = true; },
    unmount: () => [...screenSlots, ...providerSlots].forEach((at) => at.cleanup?.()),
  };
}

/** A five-Track public pre-order page, with inert URLs authored for this boundary (task 0072). */
function previewPage(playing: number): BandcampDocument {
  return {
    endpoint: 'release_page', fetchedAt: new Date().toISOString(),
    payload: releasePagePayload({
      itemId: PREORDER_ITEM_ID, itemUrl: PREORDER_URL,
      tralbum: {
        current: { id: PREORDER_ITEM_ID, type: 'album', band_id: BAND_ID, release_date: '13 Oct 2026 00:00:00 GMT', publish_date: '29 Sep 2026 00:00:00 GMT' },
        is_preorder: true,
        trackinfo: Array.from({ length: 5 }, (_, i) => ({
          id: i < playing ? 101 + i : null, track_id: 101 + i, track_num: i + 1, title: `Track ${i + 1}`, streaming: 1,
          unreleased_track: i >= playing, file: i < playing ? { 'mp3-128': `https://audio.invalid/${101 + i}` } : null,
        })),
      },
    }),
  };
}

/** The "1/4" pill the Upcoming list draws on the shelf-held Release's row. */
function pillOf(items: readonly Item[]): string | null | undefined {
  const item = items.find((entry) => entry.key === `a:${PREORDER_ITEM_ID}`);
  return item === undefined ? undefined : copy.tracksOutPill(item.tracksOut ?? null, item.numTracks ?? null);
}

async function seedUndetailedUpcoming(db: SQLiteDatabase) {
  await insertRawDocument(db, { endpoint: 'following_bands', payload: followingBandsFirstPage(), fetchedAt: '2026-09-29T10:00:00.000Z' });
  await insertRawDocument(db, {
    endpoint: 'band_details', fetchedAt: '2026-09-29T10:01:00.000Z',
    payload: bandDetailsPayload({ items: [discographyItem({ item_id: PREORDER_ITEM_ID, release_date: '13 Oct 2026 00:00:00 GMT', item_url: PREORDER_URL })] }),
  });
  await fold(db);
}

test('a preview page refreshes mounted Upcoming facts; duplicate pages, coalesced writes and an unfocused screen respect their gates', async (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout', 'setInterval'], now: Date.parse('2026-10-12T12:00:00.000Z') });
  const { db, close } = await openTestStore();
  t.after(close);
  await seedUndetailedUpcoming(db);
  const at = mount('../app/(tabs)/releases/upcoming.tsx', db, true);
  t.after(at.unmount);
  assert.equal(pillOf(await at.read()), null, 'the shelf-held Release initially has no page-derived pill');
  const first = previewPage(1);
  assert.equal((await at.app().putRaw(first)).deduped, false);
  assert.equal((await db.getFirstAsync<{ n: number }>('select num_tracks as n from releases where item_id = ?', [PREORDER_ITEM_ID]))?.n, 5);
  assert.equal(pillOf(await at.read()), '1/5', 'the preview fold must reach the mounted Upcoming query without a gather');
  const version = at.app().version;
  assert.equal((await at.app().putRaw({ ...first, fetchedAt: new Date(Date.now() + 1).toISOString() })).deduped, true);
  await at.read();
  assert.equal(at.app().version, version, 'an identical page does not invalidate the view');
  await at.app().putRaw(previewPage(2));
  await at.app().putRaw(previewPage(3));
  assert.equal(pillOf(await at.read()), '1/5', 'rapid pages share the existing trailing invalidation');
  t.mock.timers.tick(1_999);
  assert.equal(pillOf(await at.read()), '1/5');
  t.mock.timers.tick(1);
  assert.equal(pillOf(await at.read()), '3/5');
  assert.equal(at.app().version, version + 1, 'both admitted pages share one version move');
  at.focus(false);
  await at.read();
  await at.app().putRaw(previewPage(4));
  t.mock.timers.tick(2_000);
  assert.equal(pillOf(await at.read()), '3/5', 'a hidden screen retains its last followed version');
  t.mock.timers.tick(9_999);
  assert.equal(pillOf(await at.read()), '3/5');
  t.mock.timers.tick(1);
  assert.equal(pillOf(await at.read()), '4/5', 'the settled hidden screen follows the successful preview fold');
  const after = at.app().version;
  await at.app().putRaw({ endpoint: CRUMBS_PAGE_ENDPOINT, payload: { url: PREORDER_URL, status: 200, bytes: 50 }, fetchedAt: new Date().toISOString() });
  await at.read();
  assert.equal(at.app().version, after, 'a crumb extract projects no visible Release facts');
});

test('a preview page whose fold fails keeps the mounted answer and version while retaining its Raw Document', async (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout', 'setInterval'], now: Date.parse('2026-10-12T12:00:00.000Z') });
  const { db, close } = await openTestStore();
  t.after(close);
  await seedUndetailedUpcoming(db);
  const at = mount('../app/(tabs)/releases/upcoming.tsx', db, true);
  t.after(at.unmount);
  assert.equal(pillOf(await at.read()), null);
  const version = at.app().version;
  await db.execAsync("create trigger full before update on releases begin select raise(abort, 'database or disk is full'); end");
  await assert.rejects(at.app().putRaw(previewPage(1)), /database or disk is full/);
  t.mock.timers.tick(12_000);
  const answer = await at.read();
  assert.equal(at.app().version, version);
  assert.equal(pillOf(answer), null);
  assert.equal((await countForProjection(db)).waiting, 1, 'the failed fold retains the committed observation');
});

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
    // A card's day and an Upcoming row's day both carry the month, with no "out" and no weekday (task 0071, decisions 10
    // and 14, amended by the author 2026-10-14).
    const [before, onTheDay] = ['13 Oct', 'Today'];
    const first = await at.read();
    assert.equal(label(first), before);
    const heard = file.endsWith('/index.tsx') ? first.find((item) => item.kind === 'shelf')?.cards?.[0]?.out : first.find((item) => item.key === `a:${PREORDER_ITEM_ID}`)?.heardDay;
    assert.equal(heard, 'out Tue 13 Oct', 'the label keeps the weekday the eyebrow leaves out');
    t.mock.timers.tick(30_000);
    assert.equal(label(await at.read()), onTheDay, 'labels follow local midnight while the Release remains Upcoming');
    t.mock.timers.tick(7_170_000);
    assert.equal(new Date().getHours(), 1);
    assert.equal(new Date().getUTCDate(), 12);
    assert.equal(label(await at.read()), onTheDay);
    t.mock.timers.tick(30_000);
    assert.equal(new Date().getHours(), 2);
    assert.equal(new Date().getUTCDate(), 13);
    const items = await at.read();
    if (file.endsWith('/index.tsx')) {
      assert.equal(items.some((item) => item.kind === 'shelf'), false, 'GMT midnight removes the Upcoming shelf without a store change');
      const released = items.find((item) => item.kind === 'release' && item.key === `item:a:${PREORDER_ITEM_ID}`);
      assert.ok(released, 'the released weeks receive the held Release');
      assert.deepEqual([released.day, released.heardDay], [undefined, 'Today'], 'a released row draws no day line and its label still says the day');
    } else {
      assert.equal(items.map((item) => item.kind).join(','), 'empty', 'GMT midnight removes the Release from the full Upcoming list');
    }
  });
}

test("New releases takes ?people=1 as the people filter at 1+ with the Fan's tags, clears it, and filters the list", async (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setInterval'], now: Date.parse('2026-10-12T10:00:00.000Z') });
  const { db, close } = await openTestStore();
  t.after(close);
  await insertRawDocument(db, {
    endpoint: 'fan_dash_feed_updates', payload: feedPayload({ entries: [preorderNrEntry()] }), fetchedAt: '2026-09-29T10:00:00.000Z',
  });
  await insertRawDocument(db, {
    endpoint: 'release_page', payload: releasePagePayload({ itemId: PREORDER_ITEM_ID, itemUrl: PREORDER_URL, tralbum: preorderTralbumBlob() }), fetchedAt: '2026-09-29T10:05:00.000Z',
  });
  await fold(db);
  const rig: FilterRig = { settings: { people: { on: false, min: 4 }, tags: ['dub'] }, params: { people: '1' }, updates: [] };
  const at = mount('../app/(tabs)/releases/index.tsx', db, false, rig);
  t.after(at.unmount);
  const items = await at.read();
  assert.deepEqual(rig.updates, [{ people: { on: true, min: 1 }, tags: ['dub'] }]);
  assert.equal(rig.params.people, undefined, 'the param is cleared once taken');
  const header = items.find((item) => item.kind === 'header') as Item & { filteredBy: string | null };
  assert.equal(header.filteredBy, 'Filtered by 1+ you follow · dub');
  // Nobody bought the one held Release, so the filter keeps nothing and names itself.
  assert.equal(items.map((item) => item.kind).join(','), 'header,nomatch');
  // The Fan clears the filter; a later render finds no param, and following the link again is a new link.
  rig.settings = filterSettings.NOTHING_CHOSEN;
  at.touch();
  await at.read();
  assert.equal(rig.updates.length, 1, 'a cleared link is not taken again');
  rig.params = { people: '1' };
  at.touch();
  await at.read();
  assert.deepEqual(rig.updates.at(-1), { people: { on: true, min: 1 }, tags: [] });
  assert.equal(rig.updates.length, 2);
});

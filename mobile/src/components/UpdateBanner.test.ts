/// <reference types="node" />
/** The banner press uses the installed binary's capability, including old builds without its bridge. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { setImmediate } from 'node:timers/promises';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

type Element = { type: string | ((props: Record<string, unknown>) => Element); props: Record<string, unknown> };
type Fixture = {
  platform: string;
  channel: string;
  launcher: boolean;
  permission: boolean | null;
  opened: string[];
  downloaded: string[];
  intents: unknown[];
};
const OLD = 'a'.repeat(40);
const APK = { build: 10, fingerprint: 'b'.repeat(40), url: 'https://dl.wavfeed.com/android/wavfeed-10.apk', md5: 'c'.repeat(32) };
const rig = globalThis as typeof globalThis & { __bannerFixture: Fixture; __bannerAnswer: unknown };
rig.__bannerAnswer = { answer: { apk: APK, android: { build: 10, fingerprint: APK.fingerprint }, ios: { build: 10, fingerprint: APK.fingerprint } }, hidden: null };
const stub = (source: string) => `data:text/javascript,${encodeURIComponent(source)}`;
const native = new Map([
  ['expo', `export function requireOptionalNativeModule(name) {
    const f = globalThis.__bannerFixture;
    if (name === 'ExpoIntentLauncher') return f.launcher ? {} : null;
    if (name === 'ExpoApkInstallPermission') return f.permission === null ? null : { declaresInstallPackages: f.permission };
    throw new Error('Unexpected native module: ' + name);
  }`],
  ['react', `export const useEffect = () => {};
    export const useSyncExternalStore = () => globalThis.__bannerAnswer;
    export const useState = (initial) => [initial, () => {}];`],
  ['react/jsx-runtime', `export const jsx = (type, props) => ({ type, props }); export const jsxs = jsx;`],
  ['react-native', `export const Platform = { get OS() { return globalThis.__bannerFixture.platform; } };
    export const Pressable = 'Pressable'; export const View = 'View'; export const AppState = {}; export const LayoutAnimation = {};`],
  ['expo-application', `export const nativeBuildVersion = '3';`],
  ['expo-updates', `export const runtimeVersion = '${OLD}'; export const isEnabled = true;
    export const channel = globalThis.__bannerFixture.channel;`],
  ['expo-linking', `export async function openURL(url) { globalThis.__bannerFixture.opened.push(url); }`],
  ['expo-file-system/legacy', `export const cacheDirectory = 'file:///cache/';
    export function createDownloadResumable(url) {
      globalThis.__bannerFixture.downloaded.push(url); return { downloadAsync: async () => ({ status: 200 }) };
    }
    export const getInfoAsync = async () => ({ exists: true, md5: '${APK.md5}' });
    export const getContentUriAsync = async () => 'content://wavfeed/cache/wavfeed-10.apk';
    export const deleteAsync = async () => {};`],
  ['expo-intent-launcher', `export async function startActivityAsync(action, params) { globalThis.__bannerFixture.intents.push({ action, params }); }`],
  ['@/player/motion', `export const useReduceMotion = () => false;`],
  ['@/state/appState', `export const useAppState = () => ({ db: {} });`],
  ['@/store/kv', `export const readKv = async () => null; export const writeKv = async () => {};`],
  ['@/theme/tokens', `export const useTokens = () => ({ c: {} }); export const type = {}; export const ripple = () => ({}); export const pressedOpacity = () => 1;`],
  ['./Glyph', `export const Glyph = 'Glyph';`],
  ['./Type', `export const Type = 'Type';`],
]);

// Node strips .ts; only the real banner's JSX needs transpiling. Native IO and React hooks stay at the test boundary.
registerHooks({
  resolve(specifier, context, next) {
    const source = native.get(specifier);
    if (source) return { url: stub(source), shortCircuit: true };
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url.startsWith('file:') && new URL(url).pathname.endsWith('/UpdateBanner.tsx')) {
      return { format: 'module', source: ts.transpileModule(readFileSync(fileURLToPath(url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX } }).outputText, shortCircuit: true };
    }
    return next(url, context);
  },
});

function elements(element: Element): Element[] {
  if (typeof element.type === 'function') return elements(element.type(element.props));
  const children = [element.props.children].flat().filter((child): child is Element => typeof child === 'object' && child !== null && 'props' in child);
  return [element, ...children.flatMap(elements)];
}

const cases = [
  { name: 'preview with the launcher but no declared permission opens the download', platform: 'android', channel: 'preview', launcher: true, permission: false, install: false },
  { name: 'a preview binary that declares the permission installs without guessing from its channel', platform: 'android', channel: 'preview', launcher: true, permission: true, install: true },
  { name: 'an old APK binary without the capability bridge opens the download', platform: 'android', channel: 'apk', launcher: true, permission: null, install: false },
  { name: 'a website APK with the declared permission downloads and hands Android the verified file', platform: 'android', channel: 'apk', launcher: true, permission: true, install: true },
  { name: 'a binary without the launcher opens the download even with the permission', platform: 'android', channel: 'apk', launcher: false, permission: true, install: false },
  { name: 'a Play install opens Play even if native APK capabilities are present', platform: 'android', channel: 'production', launcher: true, permission: true, install: false, store: 'market://details?id=com.wavfeed.app' },
  { name: 'an iPhone opens TestFlight', platform: 'ios', channel: 'production', launcher: true, permission: true, install: false, store: 'itms-beta://beta.itunes.apple.com/v1/app/6817516210' },
] as const;

for (const [index, scenario] of cases.entries()) {
  test(scenario.name, async () => {
    rig.__bannerFixture = { ...scenario, opened: [], downloaded: [], intents: [] };
    // The channel and platform are binary facts read at module load, so each scenario loads a fresh banner and updates module.
    const hook = registerHooks({ resolve(specifier, context, next) {
      if (specifier === 'expo-updates') return { url: `${stub(native.get(specifier)!)}#${index}`, shortCircuit: true };
      if (specifier === '@/copy') {
        const resolved = next(specifier, context);
        return { ...resolved, url: `${resolved.url}?binary=${index}` };
      }
      return next(specifier, context);
    } });
    try {
      const { UpdateBanner } = await import(`./UpdateBanner.tsx?binary=${index}`);
      const tree = elements(UpdateBanner({ hideable: false }));
      const press = tree.find((element) => element.type === 'Pressable')!;
      const text = tree.filter((element) => element.type === 'Type').map((element) => element.props.children);
      (press.props.onPress as () => void)();
      await setImmediate();
      const f = rig.__bannerFixture;
      assert.deepEqual(f.opened, scenario.install ? [] : ['store' in scenario ? scenario.store : APK.url]);
      assert.deepEqual(f.downloaded, scenario.install ? [APK.url] : []);
      assert.deepEqual(f.intents, scenario.install ? [{ action: 'android.intent.action.VIEW', params: { data: 'content://wavfeed/cache/wavfeed-10.apk', flags: 1, type: 'application/vnd.android.package-archive' } }] : []);
      assert.ok(text.includes(scenario.install ? 'Install build 10' : 'store' in scenario ? scenario.platform === 'ios' ? 'Open TestFlight' : 'Open Google Play' : 'Download build 10'));
    } finally {
      hook.deregister();
    }
  });
}

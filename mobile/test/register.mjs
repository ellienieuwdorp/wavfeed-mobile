/**
 * Lets `node --test` load the app's TypeScript as Metro would: Node strips the types, and this hook resolves the `@/`
 * alias and extensionless imports to `.ts` files. `expo-sqlite` is the native module a store import reaches; its
 * stand-in refuses to open, since tests hand the store a `node:sqlite` database (test/nodeDb.ts). The Bandcamp session
 * reaches `react-native` for `Platform.select`, whose stand-in answers the `default` case, and Metro's `__DEV__` global,
 * set false here as in a release bundle.
 */
import { existsSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '../src');
const NATIVE_STORE = `data:text/javascript,${encodeURIComponent(
  "export function openDatabaseAsync() { throw new Error('tests open their store with test/nodeDb.ts'); }",
)}`;
const NATIVE_PLATFORM = `data:text/javascript,${encodeURIComponent(
  'export const Platform = { OS: "web", select: (cases) => cases.default };',
)}`;

globalThis.__DEV__ = false;

registerHooks({
  resolve(specifier, context, next) {
    if (specifier === 'expo-sqlite') return { url: NATIVE_STORE, shortCircuit: true };
    if (specifier === 'react-native') return { url: NATIVE_PLATFORM, shortCircuit: true };
    let base = null;
    if (specifier.startsWith('@/')) base = resolve(SRC, specifier.slice(2));
    else if (/^\.\.?\//.test(specifier) && context.parentURL?.startsWith('file:')) {
      base = resolve(dirname(fileURLToPath(context.parentURL)), specifier);
    }
    if (base !== null) {
      for (const file of [`${base}.ts`, `${base}/index.ts`]) {
        if (existsSync(file)) return next(pathToFileURL(file).href, context);
      }
    }
    return next(specifier, context);
  },
});

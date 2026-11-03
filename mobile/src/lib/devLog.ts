/**
 * The app's development log (review PRIV-2): a `console.log` in a development bundle and nothing in a release one, so
 * the device log of a tester's phone carries no gather turn, fold or press line. Warnings stay on `console.warn`. A
 * call site whose arguments cost work writes `if (__DEV__) devLog(...)`: Metro inlines `__DEV__` as `false` in a release
 * bundle, so the minifier drops the call with its strings and their work.
 */
export function devLog(...parts: unknown[]): void {
  // oxlint-disable-next-line no-console -- the one home of the development log
  if (__DEV__) console.log(...parts);
}

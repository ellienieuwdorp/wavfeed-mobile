/**
 * The simulator rig as the screens reach it: `useSampleData.ts` in a development bundle, null in a release
 * one. The literal `__DEV__` lets Metro fold the require away before it collects dependencies, so `sample.ts` stays out
 * of every release bundle and EAS Update (review ARCH-5); CI's export checks it.
 */
// eslint-disable-next-line @typescript-eslint/no-require-imports -- a static import would keep the rig in every bundle
export const sampleRig: typeof import('./useSampleData') | null = __DEV__ ? require('./useSampleData') : null;

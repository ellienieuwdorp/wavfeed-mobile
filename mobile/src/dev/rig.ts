/**
 * The simulator rig as the screens reach it: `useSampleData.ts` in a development bundle, null in a release
 * one. The literal `__DEV__` lets Metro fold the require away before it collects dependencies, so `sample.ts` stays out
 * of every release bundle and EAS Update (review ARCH-5); CI's export checks it.
 */
export const sampleRig: typeof import('./useSampleData') | null = __DEV__ ? require('./useSampleData') : null;

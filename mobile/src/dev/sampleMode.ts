/**
 * The simulator rig's switch (task 0036): true only in a development bundle served with EXPO_PUBLIC_SAMPLE=1. The
 * session refuses every request under it, so the rig never talks to Bandcamp (ADR-0001).
 */
export const SAMPLE_MODE = __DEV__ && process.env.EXPO_PUBLIC_SAMPLE === '1';

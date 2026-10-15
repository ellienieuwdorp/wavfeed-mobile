/**
 * The app's shared motion (DESIGN-UI sections 10 and 11, task 0036): the system's reduce motion setting as a live value,
 * for every moving mark, the press every playable surface answers with, and the Filters sheet's pressed tone, each a
 * progress from 0 at rest to 1 held that Reanimated runs on the UI thread, so the feedback costs the JS thread one
 * assignment and no re-render.
 */
import { useCallback } from 'react';
import { AccessibilityInfo } from 'react-native';
import { Easing, useReducedMotion, useSharedValue, withSpring, withTiming, type SharedValue } from 'react-native-reanimated';

import { liveSetting, useLiveSetting } from '@/lib/a11y';

const REDUCE_MOTION = liveSetting(
  () => AccessibilityInfo.isReduceMotionEnabled(),
  (set) => AccessibilityInfo.addEventListener('reduceMotionChanged', set),
);

/**
 * The app's one reduce motion reading (VIS-14): every moving mark, the art's press included, asks here. Until the
 * native read answers it is Reanimated's reading at launch, a synchronous global, so the first frame is already right.
 */
export function useReduceMotion(): boolean {
  return useLiveSetting(REDUCE_MOTION, useReducedMotion());
}

/** A pressed artwork's scale and the black it dims under, at full progress (DESIGN-UI section 11, the art plays). */
export const PRESS_SCALE = 0.96;
export const PRESS_SHADE = 0.18;

// Eased in with no overshoot so the press lands at once; sprung back underdamped (damping ratio about 0.65) for the
// small settle past rest that reads as a release. Reanimated's own ReduceMotion.System jumps both to their end.
const PRESS_IN = { duration: 90, easing: Easing.out(Easing.quad) };
const PRESS_OUT = { mass: 0.6, stiffness: 320, damping: 18 };

export type PressMotion = { progress: SharedValue<number>; onPressIn: () => void; onPressOut: () => void };

/** Spread `onPressIn` and `onPressOut` on a Pressable and read `progress` in an animated style; it may dip below 0 on the way back. */
export function usePressMotion(): PressMotion {
  const progress = useSharedValue(0);
  const onPressIn = useCallback(() => progress.set(withTiming(1, PRESS_IN)), [progress]);
  const onPressOut = useCallback(() => progress.set(withSpring(0, PRESS_OUT)), [progress]);
  return { progress, onPressIn, onPressOut };
}

// Shown at once on finger down, as a grouped list's cell is, and faded from finger up.
const TONE_OUT = { duration: 220, easing: Easing.out(Easing.quad) };

export type PressTone = { tone: SharedValue<number>; onPressIn: () => void; release: () => void };

/**
 * The Filters sheet's pressed grey or dim (task 0071, the author's request of 2026-10-15). Call `release` from
 * `onPress` as well as `onPressOut`: Pressable holds a short tap's press out for 130 ms on a timer, which waits behind
 * the render of the list the tap changes, while `onPress` runs as the finger lifts.
 */
export function usePressTone(): PressTone {
  const tone = useSharedValue(0);
  const onPressIn = useCallback(() => tone.set(1), [tone]);
  const release = useCallback(() => tone.set(withTiming(0, TONE_OUT)), [tone]);
  return { tone, onPressIn, release };
}

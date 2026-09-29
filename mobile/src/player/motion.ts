/**
 * The app's shared motion (DESIGN-UI sections 10 and 11, task 0036): the system's reduce motion setting as a live value,
 * for the player's moving marks, and the press every playable surface answers with, a progress from 0 at rest to 1 held
 * that Reanimated runs on the UI thread, so the feedback costs the JS thread one assignment and no re-render.
 */
import { useCallback, useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';
import { Easing, useSharedValue, withSpring, withTiming, type SharedValue } from 'react-native-reanimated';

export function useReduceMotion(): boolean {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    let alive = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((on) => {
      if (alive) setReduce(on);
    });
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduce);
    return () => {
      alive = false;
      subscription.remove();
    };
  }, []);
  return reduce;
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

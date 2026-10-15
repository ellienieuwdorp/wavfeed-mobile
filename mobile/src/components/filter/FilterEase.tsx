/**
 * A filter change eased in the lists it narrows (task 0071, decision 7, the author's request of 2026-10-15): rows that
 * leave fade out, rows that arrive fade in and the rest slide to their places, about 260 ms on a gentle ease. Each list
 * cell carries Reanimated layout animations written as worklets that ask one shared flag, `landing`, whether a filter
 * change is being drawn; it is raised once a tap has committed in the sheet and the list's render is still to come,
 * and lowered a little after that render lands, so a first read, rows a scroll mounts and a pull to refresh move
 * nothing; a cell off screen moves at once. With reduce motion on the flag is never raised, so every change lands at once.
 */
import { useDeferredValue, useEffect, useState } from 'react';
import type { CellRendererProps } from 'react-native';
import Animated, {
  Easing,
  makeMutable,
  useReducedMotion,
  withDelay,
  withTiming,
  type EntryAnimationsValues,
  type ExitAnimationsValues,
  type LayoutAnimation,
  type LayoutAnimationsValues,
} from 'react-native-reanimated';

import { useReduceMotion } from '@/player/motion';
import type { FilterSettings } from '@/state/filterSettings';

// Material's standard curve, slow off the mark and slow to land; arrivals wait out most of the leaving fade.
const MOVE = { duration: 260, easing: Easing.bezier(0.4, 0, 0.2, 1) };
const ARRIVE = { duration: 220, easing: Easing.out(Easing.quad) };
const ARRIVE_AFTER = 60;
const LEAVE = { duration: 150, easing: Easing.out(Easing.quad) };
/** How long `landing` stays up after the list's render commits, so the UI thread mounts that commit before it drops. */
const SETTLE_MS = 120;
/**
 * The beat a list waits after the sheet's last change before it renders the new settings: the tapped control's tick and
 * pressed tone (about 200 ms, components/filter/Controls.tsx) finish before the list's new rows are mounted on the same
 * UI thread, and taps closer together than the beat render the list once.
 */
const BEAT_MS = 150;

const landing = makeMutable(false);

/**
 * The settings a list behind the Filters sheet applies: the sheet's, a beat after its last change, as a deferred render
 * a newer change interrupts, with the change eased. A first read, or a store opened afresh, applies at once.
 */
export function useListFilter(settings: FilterSettings | null): FilterSettings | null {
  const [beat, setBeat] = useState<FilterSettings | null>(null);
  useEffect(() => {
    if (beat === settings) return;
    const wait = setTimeout(() => setBeat(settings), beat === null || settings === null ? 0 : BEAT_MS);
    return () => clearTimeout(wait);
  }, [settings, beat]);
  const applied = useDeferredValue(settings === null ? null : (beat ?? settings));
  // Raised while the list shows older settings than the sheet holds; a first read has none, so it never eases.
  const pending = applied !== null && settings !== applied;
  // Reanimated's reading too, taken at launch, which FilterEaseCell follows.
  const live = useReduceMotion();
  const atLaunch = useReducedMotion();
  const reduceMotion = live || atLaunch;
  useEffect(() => {
    if (pending && !reduceMotion) {
      landing.set(true);
      return;
    }
    const settle = setTimeout(() => landing.set(false), SETTLE_MS);
    return () => clearTimeout(settle);
  }, [pending, reduceMotion]);
  return applied;
}

const AT_REST: LayoutAnimation = { initialValues: {}, animations: {} };

/** Whether a cell between `top` and `top + height` on the window shows; the rows a list keeps mounted off screen go at once. */
function shows(top: number, height: number, windowHeight: number): boolean {
  'worklet';
  return top + height > 0 && top < windowHeight;
}

function arrive(v: EntryAnimationsValues): LayoutAnimation {
  'worklet';
  if (!landing.get() || !shows(v.targetGlobalOriginY, v.targetHeight, v.windowHeight)) return AT_REST;
  return { initialValues: { opacity: 0 }, animations: { opacity: withDelay(ARRIVE_AFTER, withTiming(1, ARRIVE)) } };
}

function leave(v: ExitAnimationsValues): LayoutAnimation {
  'worklet';
  if (!landing.get() || !shows(v.currentGlobalOriginY, v.currentHeight, v.windowHeight)) return AT_REST;
  return { initialValues: { opacity: 1 }, animations: { opacity: withTiming(0, LEAVE) } };
}

function move(v: LayoutAnimationsValues): LayoutAnimation {
  'worklet';
  const seen = shows(v.currentGlobalOriginY, v.currentHeight, v.windowHeight) || shows(v.targetGlobalOriginY, v.targetHeight, v.windowHeight);
  if (!landing.get() || !seen) {
    return { initialValues: { originX: v.targetOriginX, originY: v.targetOriginY, width: v.targetWidth, height: v.targetHeight }, animations: {} };
  }
  return {
    initialValues: { originX: v.currentOriginX, originY: v.currentOriginY, width: v.currentWidth, height: v.currentHeight },
    animations: {
      originX: withTiming(v.targetOriginX, MOVE),
      originY: withTiming(v.targetOriginY, MOVE),
      width: withTiming(v.targetWidth, MOVE),
      height: withTiming(v.targetHeight, MOVE),
    },
  };
}

/**
 * A FlatList's `CellRendererComponent` for a list the filter narrows. Under reduce motion it carries no layout
 * animation at all: Reanimated ends one on its first frame there, which leaves a moved cell where it started.
 */
export function FilterEaseCell({ children, style, onLayout }: CellRendererProps<unknown>) {
  const still = useReducedMotion();
  return (
    <Animated.View style={style} onLayout={onLayout} entering={still ? undefined : arrive} exiting={still ? undefined : leave} layout={still ? undefined : move}>
      {children}
    </Animated.View>
  );
}

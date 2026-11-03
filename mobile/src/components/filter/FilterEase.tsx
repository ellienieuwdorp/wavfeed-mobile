/**
 * A filter change eased in the lists it narrows (the author's request of 2026-10-15): rows that
 * leave fade out, rows that arrive fade in and the rest slide to their places, about 260 ms on a gentle ease. A cell
 * carries Reanimated layout animations only while it is armed, React state the cells read, raised while the Filters
 * sheet is open and while a list draws a filter change, and lowered once that change's animations have run; at rest a
 * cell is a plain view that follows every relayout (a scroll, a pull to refresh, a text size change). Armed, the
 * worklets ask `landing`, raised on the UI thread once a tap has committed in the sheet and the list's render is still
 * to come and lowered a little after that render lands; any other relayout, and a cell off screen, moves at once. With
 * reduce motion on neither is raised.
 */
import { useDeferredValue, useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import type { CellRendererProps } from 'react-native';
import Animated, {
  Easing,
  makeMutable,
  useReducedMotion,
  withDelay,
  withSequence,
  withTiming,
  type EntryAnimationsValues,
  type ExitAnimationsValues,
  type LayoutAnimation,
  type LayoutAnimationsValues,
} from 'react-native-reanimated';

import { useReduceMotion } from '@/player/motion';
import { NOTHING_CHOSEN, type FilterSettings } from '@/state/filterSettings';

// Material's standard curve, slow off the mark and slow to land; arrivals wait out most of the leaving fade.
const MOVE = { duration: 260, easing: Easing.bezier(0.4, 0, 0.2, 1) };
const ARRIVE = { duration: 220, easing: Easing.out(Easing.quad) };
const ARRIVE_AFTER = 60;
const LEAVE = { duration: 150, easing: Easing.out(Easing.quad) };
const AT_ONCE = { duration: 0 };
/**
 * A few frames a move holds at its target once there. On iOS Reanimated 4.5 flushes a layout animation's frames once
 * per frame, after its end, and skips an animation that has ended, so a move's last frame never lands; one that ends
 * on its first frame leaves the cell at its old frame for good. Held, the frame that lands is the target.
 */
const HOLD = { duration: 50 };
/** How long `landing` stays up after the list's render commits, so the UI thread mounts that commit before it drops. */
const SETTLE_MS = 120;
/** How long the cells stay armed after `landing` drops: the longest animation, a shelf card's arrival, has run by then. */
const ARMED_MS = MOVE.duration + ARRIVE.duration + 60;
/**
 * The beat a list waits after the sheet's last change before it renders the new settings: the tapped control's tick and
 * pressed tone (about 200 ms, components/filter/Controls.tsx) finish before the list's new rows are mounted on the same
 * UI thread, and taps closer together than the beat render the list once.
 */
const BEAT_MS = 150;

const landing = makeMutable(false);

/** What holds the cells armed: an open Filters sheet, and each list drawing a filter change. */
const holders = new Set<object>();
/** The lists drawing a filter change now; New releases and the Upcoming list can both be mounted. */
const drawing = new Set<object>();
let armed = false;
let disarm: ReturnType<typeof setTimeout> | undefined;
const armedListeners = new Set<() => void>();

function setArmed(on: boolean) {
  if (armed === on) return;
  armed = on;
  for (const listener of armedListeners) listener();
}

function hold(holder: object, on: boolean) {
  if (on) holders.add(holder);
  else holders.delete(holder);
  clearTimeout(disarm);
  if (holders.size > 0) setArmed(true);
  else disarm = setTimeout(() => setArmed(false), ARMED_MS);
}

function draw(list: object, on: boolean) {
  if (on) drawing.add(list);
  else drawing.delete(list);
  landing.set(drawing.size > 0);
  hold(list, on);
}

function subscribeArmed(listener: () => void) {
  armedListeners.add(listener);
  return () => armedListeners.delete(listener);
}

const readArmed = () => armed;

function useArmed(): boolean {
  return useSyncExternalStore(subscribeArmed, readArmed);
}

/** The system's reduce motion setting, live, or Reanimated's reading of it at launch, which its layout animations follow. */
function useStill(): boolean {
  const live = useReduceMotion();
  const atLaunch = useReducedMotion();
  return live || atLaunch;
}

/**
 * Arms the cells while the Filters sheet is open, so the work of arming them is done before a tap and never on the
 * frames that answer one. With reduce motion on it arms nothing.
 */
export function useArmWhileOpen() {
  const still = useStill();
  useEffect(() => {
    if (still) return;
    const sheet = {};
    hold(sheet, true);
    return () => hold(sheet, false);
  }, [still]);
}

/**
 * The settings a list behind the Filters sheet applies: the sheet's, a beat after its last change, as a deferred render
 * a newer change interrupts, with the change eased. A first read, or a store opened afresh, applies at once; nothing
 * saved yet reads as nothing chosen, so the first change a store ever sees eases too.
 */
export function useListFilter(saved: FilterSettings | null, loaded: boolean): FilterSettings | null {
  const settings = loaded ? (saved ?? NOTHING_CHOSEN) : null;
  const [beat, setBeat] = useState<FilterSettings | null>(null);
  useEffect(() => {
    if (beat === settings) return;
    const wait = setTimeout(() => setBeat(settings), beat === null || settings === null ? 0 : BEAT_MS);
    return () => clearTimeout(wait);
  }, [settings, beat]);
  const applied = useDeferredValue(settings === null ? null : (beat ?? settings));
  // Raised while the list shows older settings than the sheet holds; a first read has none, so it never eases.
  const pending = applied !== null && settings !== applied;
  const still = useStill();
  const [list] = useState(() => ({}));
  useEffect(() => {
    if (pending && !still) {
      draw(list, true);
      return;
    }
    const settle = setTimeout(() => draw(list, false), SETTLE_MS);
    return () => clearTimeout(settle);
  }, [list, pending, still]);
  useEffect(() => () => draw(list, false), [list]);
  return applied;
}

const AT_REST: LayoutAnimation = { initialValues: {}, animations: {} };

/** Whether a cell from `start` to `start + size` along the list's axis shows in a window `window` long. */
function shows(start: number, size: number, window: number): boolean {
  'worklet';
  return start + size > 0 && start < window;
}

function arriving(v: EntryAnimationsValues, across: boolean): boolean {
  'worklet';
  return landing.get() && (across ? shows(v.targetGlobalOriginX, v.targetWidth, v.windowWidth) : shows(v.targetGlobalOriginY, v.targetHeight, v.windowHeight));
}

function leaving(v: ExitAnimationsValues, across: boolean): boolean {
  'worklet';
  return landing.get() && (across ? shows(v.currentGlobalOriginX, v.currentWidth, v.windowWidth) : shows(v.currentGlobalOriginY, v.currentHeight, v.windowHeight));
}

function moving(v: LayoutAnimationsValues, across: boolean): boolean {
  'worklet';
  if (!landing.get()) return false;
  if (across) return shows(v.currentGlobalOriginX, v.currentWidth, v.windowWidth) || shows(v.targetGlobalOriginX, v.targetWidth, v.windowWidth);
  return shows(v.currentGlobalOriginY, v.currentHeight, v.windowHeight) || shows(v.targetGlobalOriginY, v.targetHeight, v.windowHeight);
}

function fadeIn(after: number): LayoutAnimation {
  'worklet';
  return { initialValues: { opacity: 0 }, animations: { opacity: withDelay(after, withTiming(1, ARRIVE)) } };
}

function fadeOut(): LayoutAnimation {
  'worklet';
  return { initialValues: { opacity: 1 }, animations: { opacity: withTiming(0, LEAVE) } };
}

function reach(target: number, how: typeof MOVE | typeof AT_ONCE) {
  'worklet';
  return withSequence(withTiming(target, how), withTiming(target, HOLD));
}

/** The move to `v`'s target frame, eased or at once, then held there (see HOLD). */
function slide(v: LayoutAnimationsValues, eased: boolean): LayoutAnimation {
  'worklet';
  const how = eased ? MOVE : AT_ONCE;
  return {
    initialValues: eased
      ? { originX: v.currentOriginX, originY: v.currentOriginY, width: v.currentWidth, height: v.currentHeight }
      : { originX: v.targetOriginX, originY: v.targetOriginY, width: v.targetWidth, height: v.targetHeight },
    animations: {
      originX: reach(v.targetOriginX, how),
      originY: reach(v.targetOriginY, how),
      width: reach(v.targetWidth, how),
      height: reach(v.targetHeight, how),
    },
  };
}

function arriveDown(v: EntryAnimationsValues): LayoutAnimation {
  'worklet';
  return arriving(v, false) ? fadeIn(ARRIVE_AFTER) : AT_REST;
}

function leaveDown(v: ExitAnimationsValues): LayoutAnimation {
  'worklet';
  return leaving(v, false) ? fadeOut() : AT_REST;
}

function moveDown(v: LayoutAnimationsValues): LayoutAnimation {
  'worklet';
  return slide(v, moving(v, false));
}

// A card arrives once the cards it lands among have slid aside, so two titles never print over each other.
function arriveAcross(v: EntryAnimationsValues): LayoutAnimation {
  'worklet';
  return arriving(v, true) ? fadeIn(MOVE.duration) : AT_REST;
}

function leaveAcross(v: ExitAnimationsValues): LayoutAnimation {
  'worklet';
  return leaving(v, true) ? fadeOut() : AT_REST;
}

function moveAcross(v: LayoutAnimationsValues): LayoutAnimation {
  'worklet';
  return slide(v, moving(v, true));
}

/**
 * A FlatList's `CellRendererComponent` for a vertical list the filter narrows. It passes on `onFocusCapture`, which
 * moves the list's render window to a cell keyboard focus enters; ViewProps does not type it, so it goes by spread.
 */
export function FilterEaseCell({ children, style, onLayout, onFocusCapture }: CellRendererProps<unknown>) {
  const on = useArmed();
  return (
    <Animated.View style={style} onLayout={onLayout} {...{ onFocusCapture }} entering={on ? arriveDown : undefined} exiting={on ? leaveDown : undefined} layout={on ? moveDown : undefined}>
      {children}
    </Animated.View>
  );
}

/** The same for a horizontal list, the Upcoming shelf. */
export function FilterEaseCardCell({ children, style, onLayout, onFocusCapture }: CellRendererProps<unknown>) {
  const on = useArmed();
  return (
    <Animated.View style={style} onLayout={onLayout} {...{ onFocusCapture }} entering={on ? arriveAcross : undefined} exiting={on ? leaveAcross : undefined} layout={on ? moveAcross : undefined}>
      {children}
    </Animated.View>
  );
}

/**
 * A line inside a kept cell whose words a filter change swaps, New releases' count line and "Filtered by" pill: give
 * each version its own `key` and the old one fades out as the new one fades in, with the rows around them.
 */
export function FilterEaseLine({ children }: { children: ReactNode }) {
  const on = useArmed();
  return (
    <Animated.View entering={on ? arriveDown : undefined} exiting={on ? leaveDown : undefined}>
      {children}
    </Animated.View>
  );
}

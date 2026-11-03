/**
 * The row's wishlist swipe (the R5 swipe canvas): a finger moving right slides the row
 * over an orange panel whose outline heart rides the panel's edge, and the row's hairline leaves while it is moved, as
 * CSS5 draws the swiped row. Past half the row's width the panel says Wishlist beside a filled heart, or Remove beside a
 * slashed one on a wishlisted row, and the heart's light haptic ticks once. The verb is latched as the pan starts, so
 * the panel keeps saying it while the row springs back after the press has flipped the heart. Lifting there is one
 * press through the heart's own `useWishlistPress` on the `swipe` surface (ADR-0016 amendment 2026-10-12), so the last
 * tap wins and a signed-out phone refuses it as it refuses the heart; lifting short of it, or a gesture the system
 * cancels, presses nothing. Either way the row springs back. Android then raises the snackbar whose Undo is one more
 * press; iOS shows nothing, the swipe again is the undo. The pan starts only past the screen's edge strips, which keep
 * iOS's edge pop and Android's back gesture, and only on a sideways drag: an up or down move fails it, so the list
 * scrolls, and a still finger keeps the long press and the art's tap. A swipe left is taken and moves nothing, with no
 * rubber band. On iOS the pan taking the touch does not cancel the row's Pressables (iOS 26.5 simulator, 2026-10-14), so
 * a swipe whose finger lifts over the row ended as the row's press and played it; the row's and the art's presses ask
 * useTakenBySwipe first and play nothing for a touch the swipe took. While membership is not asked yet, the Demo's
 * case, the swipe is off, as the heart takes no press then. The panel is drawn from a row's first touch on, so a list
 * mounting rows after a filter change does not build one for each (the author's request of 2026-10-14); the touch only
 * sets a shared value that the panel's own slot reads, so the row and its pan are not rendered again mid-touch.
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedReaction, useAnimatedStyle, useSharedValue, withSpring, type SharedValue } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import type { WishlistWriteKind } from '@/bandcamp/wishlist';
import { copy } from '@/copy';
import { turnedOnHaptic } from '@/lib/haptics';
import { useReduceMotion } from '@/player/motion';
import { useTokens } from '@/theme/tokens';
import { useMembership, useWishlistPress, type WishlistTarget } from '@/wishlist/state';
import { swipeAt, swipeVerb, undoOf } from '@/wishlist/swipe';

import { useNotice } from './noticeState';
import type { RowRelease } from './playable';
import { Type } from './Type';

const ios = Platform.OS === 'ios';
/**
 * A drag decides after this many points: sideways it is the swipe's, up or down the list's. A leftward drag is taken
 * too and moves nothing, so it cannot end as the row's tap and play.
 */
const DECIDE = 12;
/** The screen's edge strip, where iOS's edge pop and Android's back gesture start, is never the swipe's. */
const EDGE = ios ? 20 : 24;
/** The panel's words and glyph, white on the orange as CSS5 draws them. */
const ON_PANEL = '#ffffff';
const GLYPH = 24;
/** Critically damped, so the row settles at rest without passing it. */
const BACK = { mass: 1, stiffness: 400, damping: 40 };

/**
 * A press this long after a swipe ended is the swipe's own touch ending: the press reaches JS after the gesture's end
 * on the UI thread, and no finger lifts and taps again this fast.
 */
const TAKEN_MS = 250;

/** The wall clock, the same on the UI thread and in JS. */
function clock(): number {
  'worklet';
  return Date.now();
}

/**
 * The enclosing row's swipe: how far it has moved the row, for what the row hides while it is moved, and when it last
 * ended, for the presses inside it.
 */
const SwipeState = createContext<{ dx: SharedValue<number>; endedAt: SharedValue<number> } | null>(null);

/** Hides a row's hairline while its swipe moves it (CSS5's `.row5.sw .rin::after`); shown outside a swipe. */
export function useHiddenWhileSwiped() {
  const dx = useContext(SwipeState)?.dx ?? null;
  return useAnimatedStyle(() => ({ opacity: dx !== null && dx.get() > 0 ? 0 : 1 }));
}

/** For a press inside a row: whether the enclosing swipe took the touch that ends in it, so the press plays nothing. */
export function useTakenBySwipe(): () => boolean {
  const swipe = useContext(SwipeState);
  return () => swipe !== null && clock() - swipe.endedAt.get() < TAKEN_MS;
}

type Props = { release: RowRelease; width: number; children: ReactNode };

export function WishlistSwipe({ release, width, children }: Props) {
  const { c } = useTokens();
  const reduce = useReduceMotion();
  const verb = swipeVerb(useMembership(release.itemType, release.itemId));
  const press = useWishlistPress('swipe');
  const { show } = useNotice();
  const dx = useSharedValue(0);
  const armed = useSharedValue(false);
  const removing = useSharedValue(false);
  const endedAt = useSharedValue(0);
  const state = useMemo(() => ({ dx, endedAt }), [dx, endedAt]);

  const commit = (action: WishlistWriteKind) => {
    const key = { itemType: release.itemType, itemId: release.itemId };
    const target: WishlistTarget = { ...key, release: key };
    // The swipe ticked as it passed half, its one haptic; the snackbar's Undo is a button and gets the heart's.
    if (!press(target, action, true) || ios) return;
    show({
      code: null,
      text: action === 'add' ? copy.swipe.added : copy.swipe.removed,
      action: { label: copy.swipe.undo, onPress: () => void press(target, undoOf(action)) },
    });
  };

  const touched = useSharedValue(false);
  const pan = Gesture.Pan()
    .enabled(verb !== null)
    .activeOffsetX([-DECIDE, DECIDE])
    .failOffsetY([-DECIDE, DECIDE])
    .hitSlop({ left: -EDGE, right: -EDGE })
    .onBegin(() => {
      // A finger is down at least DECIDE points before the row moves, which leaves the panel a frame or two to mount.
      touched.set(true);
    })
    .onStart(() => {
      removing.set(verb === 'remove');
      armed.set(false);
    })
    .onUpdate((e) => {
      const at = swipeAt(e.translationX, width);
      dx.set(at.dx);
      if (at.armed === armed.get()) return;
      armed.set(at.armed);
      if (at.armed) scheduleOnRN(turnedOnHaptic);
    })
    .onEnd((_e, success) => {
      endedAt.set(clock());
      if (success && armed.get()) scheduleOnRN(commit, removing.get() ? 'remove' : 'add');
    })
    .onFinalize(() => {
      dx.set(reduce ? 0 : withSpring(0, BACK));
    });

  const slide = useAnimatedStyle(() => ({ transform: [{ translateX: dx.get() }] }));

  return (
    <GestureDetector gesture={pan}>
      <View>
        <PanelSlot touched={touched} dx={dx} armed={armed} removing={removing} width={width} />
        <Animated.View style={[{ backgroundColor: c.bg }, slide]}>
          <SwipeState.Provider value={state}>{children}</SwipeState.Provider>
        </Animated.View>
      </View>
    </GestureDetector>
  );
}

type PanelProps = { dx: SharedValue<number>; armed: SharedValue<boolean>; removing: SharedValue<boolean>; width: number };

/** Mounts the panel once the row is first touched, re-rendering only itself, never the row's gesture. */
function PanelSlot({ touched, ...panel }: PanelProps & { touched: SharedValue<boolean> }) {
  const [drawn, setDrawn] = useState(false);
  useAnimatedReaction(
    () => touched.get(),
    (now, before) => {
      if (now && !before) scheduleOnRN(setDrawn, true);
    },
  );
  return drawn ? <Panel {...panel} /> : null;
}

/** The orange panel under a moved row, with its heart and its words. */
function Panel({ dx, armed, removing, width }: PanelProps) {
  const { c } = useTokens();
  const panel = useAnimatedStyle(() => ({ width: dx.get() }));
  const addReach = useAnimatedStyle(() => ({ opacity: !removing.get() && !armed.get() ? 1 : 0 }));
  const addCommit = useAnimatedStyle(() => ({ opacity: !removing.get() && armed.get() ? 1 : 0 }));
  const removeReach = useAnimatedStyle(() => ({ opacity: removing.get() && !armed.get() ? 1 : 0 }));
  const removeCommit = useAnimatedStyle(() => ({ opacity: removing.get() && armed.get() ? 1 : 0 }));
  return (
    <Animated.View pointerEvents="none" importantForAccessibility="no-hide-descendants" style={[styles.panel, { backgroundColor: c.wishlist }, panel]}>
      <Animated.View style={[styles.reach, addReach]}>
        <Ionicons name="heart-outline" size={GLYPH} color={ON_PANEL} />
      </Animated.View>
      <Animated.View style={[styles.reach, removeReach]}>
        <Ionicons name="heart-dislike-outline" size={GLYPH} color={ON_PANEL} />
      </Animated.View>
      <Animated.View style={[styles.commit, { width }, addCommit]}>
        <Ionicons name="heart" size={GLYPH} color={ON_PANEL} />
        <Type numberOfLines={1} style={styles.word}>
          {copy.swipe.add}
        </Type>
      </Animated.View>
      <Animated.View style={[styles.commit, { width }, removeCommit]}>
        <Ionicons name="heart-dislike" size={GLYPH} color={ON_PANEL} />
        <Type numberOfLines={1} style={styles.word}>
          {copy.swipe.remove}
        </Type>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  // The panel clips its own words; the row is not clipped, so the playing row's iOS cover still reaches the row above.
  panel: { position: 'absolute', left: 0, top: 0, bottom: 0, overflow: 'hidden' },
  // CSS5's `.swl`: the heart 20 in from the panel's moving edge while it reaches, 24 from the row's start once committed.
  reach: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', paddingRight: 20 },
  commit: { position: 'absolute', left: 0, top: 0, bottom: 0, flexDirection: 'row', alignItems: 'center', gap: 10, paddingLeft: 24 },
  word: { fontSize: 15, lineHeight: 20, fontWeight: '600', color: ON_PANEL },
});

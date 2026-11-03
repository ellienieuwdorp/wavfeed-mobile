/**
 * A cover in the page colour over iOS 26's first frames at launch, lifted once the bar's accessory has drawn its
 * contents. react-native-screens sizes the accessory's React content from the
 * frame UIKit gives the capsule, a round trip after the bar first draws, and UIKit then fades that content in, so
 * without the cover the full-width bar shows an empty capsule for about 120 ms and "Nothing playing" or the restored
 * Release fading into it over about 260 ms more. The native splash cannot hold that long in Expo Go or a dev build,
 * whose own loading screens have gone by then, so the app draws the cover. It shows only when the tabs draw at launch.
 * Its opacity runs on the native driver, holding at 1 and dropping to 0 in its last frame, so a JS thread busy with the
 * launch cannot hold it longer: the drop is timed from the accessory content's first layout at its drawn width, or from
 * the cover's mount at a ceiling, whichever comes first. Once lifted it stays lifted for the app run.
 */
import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { Animated, StyleSheet, useWindowDimensions, View } from 'react-native';

import { listeners } from '@/lib/listeners';
import { useAppState } from '@/state/appState';
import { useTokens } from '@/theme/tokens';

import { playerInAccessory } from './MiniPlayer';

/**
 * ceiling: fixed timings measured on the iOS 26.5 simulator, the content's fade at 260 ms in a debug build, and a
 * ceiling on the whole cover; a native accessory that drew its content in the bar's first frame would drop both.
 */
export const ACCESSORY_FADE_MS = 280;
export const LAUNCH_COVER_MAX_MS = 900;

const opacity = new Animated.Value(1);
let phase: 'covering' | 'lifting' | 'lifted' = 'covering';
const { subscribe, notify } = listeners();

function lifted(): void {
  phase = 'lifted';
  notify();
}

/** Holds the cover for `ms`, then drops it in one frame; a later call replaces an earlier one. */
function dropAfter(ms: number): void {
  const frame = 1000 / 60;
  const hold = ms / (ms + frame);
  Animated.timing(opacity, { toValue: 0, duration: ms + frame, easing: (t) => (t < hold ? 0 : 1), useNativeDriver: true }).start(
    ({ finished }) => {
      if (finished) lifted();
    },
  );
}

/** At the accessory content's layout at its drawn width the cover goes, once UIKit's fade-in is over. */
function liftAfterFade(): void {
  if (phase !== 'covering') return;
  phase = 'lifting';
  dropAfter(ACCESSORY_FADE_MS);
}

/**
 * Wraps the accessory's content to watch its layout. Before UIKit sizes the capsule the content is laid out at the
 * screen's width; the capsule is always inset, so a narrower layout is the one drawn.
 */
export function AccessoryLayout({ children }: { children: ReactNode }) {
  const screen = useWindowDimensions().width;
  return (
    <View
      style={{ flex: 1 }}
      onLayout={(e) => {
        const { width } = e.nativeEvent.layout;
        if (width > 0 && width < screen) liftAfterFade();
      }}
    >
      {children}
    </View>
  );
}

/** Drawn over the stack; the tabs draw at launch when the store holds a Fan. */
export function LaunchCover() {
  const { c } = useTokens();
  const hasFan = useAppState().gather.identity !== null;
  const [atLaunch] = useState(() => hasFan && playerInAccessory() && phase === 'covering');
  const gone = useSyncExternalStore(subscribe, () => phase === 'lifted');
  useEffect(() => {
    if (phase !== 'covering') return;
    // A launch onto the first screen has no cover, and a sign-in later draws the tabs without one.
    if (atLaunch) dropAfter(LAUNCH_COVER_MAX_MS);
    else lifted();
  }, [atLaunch]);
  if (!atLaunch || gone) return null;
  return <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: c.bg, opacity, pointerEvents: 'none' }]} />;
}

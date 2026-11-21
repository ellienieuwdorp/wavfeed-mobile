/**
 * The one-screen native stack each tab wraps its view in (the v2 client canvas, sections 6 and
 * 7): on iOS the large title that collapses into the bar on scroll, transparent on iOS 26 so the system draws its
 * scroll edge; on Android no native header, because the view draws Material's medium flexible app bar itself (see
 * AppBar). The dock floats over the view with the notice and the mini player (see Dock). The header's colours make
 * react-native-screens build its titles at fixed sizes, so both are sized here from the text size (theme/textSize.ts,
 * review VIS-1).
 */
import { isLiquidGlassAvailable } from 'expo-glass-effect';
import { Stack } from 'expo-router';
import { useAnimatedHeaderHeight } from 'expo-router/native-stack';
import { useMemo } from 'react';
import { Animated, Platform, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppBarFrame, BAR } from '@/components/AppBar';
import { WithDock } from '@/components/player/Dock';
import { largeTitleSize, scaledSize } from '@/theme/textSize';
import { useTokens } from '@/theme/tokens';

const ios = Platform.OS === 'ios';
const glassBar = ios && isLiquidGlassAvailable();
/** The iOS inline navigation title's size at the default text size; Android's pushed headers keep Material's. */
const BAR_TITLE = 17;

/**
 * How far the bar covers the top of a tab's list, where a sticky week head stops, as an animated value: the glass bar's
 * bottom edge as react-native-screens reports it, live through the large title's collapse, on iOS 26; nothing under an
 * opaque bar, which lays the screen out below it; the collapsed app bar over the tab's own view on Android (AppBar).
 */
export function useBarCover(pushed: boolean): Animated.AnimatedInterpolation<number> | Animated.Value {
  const header = useAnimatedHeaderHeight();
  const { top } = useSafeAreaInsets();
  const still = ios || pushed ? 0 : top + BAR;
  const fixed = useMemo(() => new Animated.Value(still), [still]);
  return glassBar ? header : fixed;
}

/** Whether the iOS 26 glass bar is up, which a list may fill while its week head is stuck (WeekHead's useWeekBands). */
export const isGlassBar = glassBar;

/** A screen the tab's view pushes, under a plain native header on both platforms. */
export type Pushed = { readonly name: string; readonly title: string };

/** `filter`: New releases, whose dock carries the filter button over its lists (see Dock). */
export function TabStack({ title, raised = false, pushed = [], filter = false }: { title: string; raised?: boolean; pushed?: readonly Pushed[]; filter?: boolean }) {
  const { c } = useTokens();
  const { fontScale } = useWindowDimensions();
  const background = raised && ios ? c.raised : c.bg;
  const bar = glassBar ? undefined : { backgroundColor: background };
  return (
    <View style={{ flex: 1, backgroundColor: background }}>
      <WithDock filter={filter}>
        <AppBarFrame title={title} background={background}>
          <Stack
            screenOptions={{
              headerShown: ios,
              headerLargeTitle: true,
              headerTransparent: glassBar,
              headerShadowVisible: false,
              headerLargeTitleShadowVisible: false,
              headerStyle: bar,
              headerLargeStyle: bar,
              headerTintColor: c.accent,
              headerTitleStyle: { color: c.ink, fontSize: ios ? Math.round(scaledSize(BAR_TITLE, fontScale, 'head')) : undefined },
              headerLargeTitleStyle: { color: c.ink, fontSize: largeTitleSize(fontScale) },
              contentStyle: { backgroundColor: background },
            }}
          >
            <Stack.Screen name="index" options={{ title }} />
            {pushed.map((screen) => (
              <Stack.Screen
                key={screen.name}
                name={screen.name}
                options={{ title: screen.title, headerShown: true, headerLargeTitle: false, headerTintColor: ios ? c.accent : c.ink, headerStyle: bar ?? (ios ? undefined : { backgroundColor: background }) }}
              />
            ))}
          </Stack>
        </AppBarFrame>
      </WithDock>
    </View>
  );
}

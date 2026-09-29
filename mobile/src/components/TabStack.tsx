/**
 * The one-screen native stack each tab wraps its view in (task 0036 decision 5, the v2 client canvas, sections 6 and
 * 7): on iOS the large title that collapses into the bar on scroll, transparent on iOS 26 so the system draws its
 * scroll edge; on Android no native header, because the view draws Material's medium flexible app bar itself (see
 * AppBar). The dock floats over the view with the notice and the mini player (see Dock).
 */
import { isLiquidGlassAvailable } from 'expo-glass-effect';
import { Stack } from 'expo-router';
import { Platform, View } from 'react-native';

import { AppBarFrame } from '@/components/AppBar';
import { WithDock } from '@/components/player/Dock';
import { useTokens } from '@/theme/tokens';

const ios = Platform.OS === 'ios';
const glassBar = ios && isLiquidGlassAvailable();

/** A screen the tab's view pushes, under a plain native header on both platforms. */
export type Pushed = { readonly name: string; readonly title: string };

export function TabStack({ title, raised = false, pushed = [] }: { title: string; raised?: boolean; pushed?: readonly Pushed[] }) {
  const { c } = useTokens();
  const background = raised && ios ? c.raised : c.bg;
  const bar = glassBar ? undefined : { backgroundColor: background };
  return (
    <View style={{ flex: 1, backgroundColor: background }}>
      <WithDock>
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
              headerTitleStyle: { color: c.ink },
              headerLargeTitleStyle: { color: c.ink },
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

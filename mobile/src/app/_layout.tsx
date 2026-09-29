/**
 * Root layout: the navigation theme built from our tokens (DESIGN-UI section 6), light and dark following the system
 * or Settings > Appearance (see `setAppearance`), the status bar styled from the same tokens because expo-status-bar's
 * `auto` reads React Native's scheme, which learns of a pick a native round trip later, the app state with its gather
 * runner and schedule (task 0036 decision 4), the player and notice state, and a stack holding the tabs, the player
 * sheet, the Bought by sheet and the Connect Bandcamp modal (task 0036 decision 5). The first launch with no Fan held
 * presents Connect once by itself. A sample bundle fills the store and gathers nothing (src/dev/useSampleData.ts). On
 * Android the window behind the edge-to-edge views takes the page tone too, so a sheet or the back gesture never shows
 * a white edge in dark.
 */
import { DarkTheme, DefaultTheme, Stack, ThemeProvider, type Theme } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { setBackgroundColorAsync } from 'expo-system-ui';
import { useEffect } from 'react';
import { Platform } from 'react-native';

import { FirstRunConnect } from '@/components/FirstRunConnect';
import { NoticeProvider } from '@/components/noticeState';
import { PlayerProvider } from '@/components/player/playerState';
import { copy } from '@/copy';
import { SAMPLE_MODE } from '@/dev/sampleMode';
import { SampleGate } from '@/dev/useSampleData';
import { AppStateProvider } from '@/state/appState';
import { GatherSchedule, runner } from '@/state/gather';
import { useTokens } from '@/theme/tokens';

const ios = Platform.OS === 'ios';

export default function RootLayout() {
  const { dark, c } = useTokens();
  useEffect(() => {
    if (!ios) setBackgroundColorAsync(c.bg).catch(() => undefined);
  }, [c.bg]);
  const base = dark ? DarkTheme : DefaultTheme;
  const theme: Theme = {
    ...base,
    dark,
    colors: {
      primary: c.accent,
      background: c.bg,
      card: c.raised,
      text: c.ink,
      border: c.border,
      notification: c.danger,
    },
  };
  return (
    <ThemeProvider value={theme}>
      <AppStateProvider runner={SAMPLE_MODE ? undefined : runner}>
        <SampleGate>
          <GatherSchedule />
          <FirstRunConnect />
          <PlayerProvider>
            <NoticeProvider>
              <StatusBar style={dark ? 'light' : 'dark'} />
              <Stack screenOptions={{ headerShown: false }}>
                <Stack.Screen name="(tabs)" />
                <Stack.Screen
                  name="player"
                  options={
                    ios
                      ? { presentation: 'modal', gestureEnabled: true, contentStyle: { backgroundColor: c.surface } }
                      : { presentation: 'formSheet', sheetAllowedDetents: 'fitToContents', sheetCornerRadius: 28, contentStyle: { backgroundColor: c.surface } }
                  }
                />
                <Stack.Screen
                  name="bought-by"
                  options={{
                    presentation: 'formSheet',
                    sheetAllowedDetents: 'fitToContents',
                    sheetGrabberVisible: true,
                    sheetCornerRadius: ios ? undefined : 28,
                    contentStyle: { backgroundColor: c.surface },
                  }}
                />
                <Stack.Screen
                  name="connect"
                  options={{
                    presentation: 'modal',
                    headerShown: true,
                    title: copy.connect.title,
                    headerLargeTitle: ios,
                    headerShadowVisible: false,
                    headerLargeTitleShadowVisible: false,
                    headerStyle: { backgroundColor: c.bg },
                    headerLargeStyle: { backgroundColor: c.bg },
                    headerTintColor: ios ? c.accent : c.ink,
                    headerTitleStyle: ios ? { color: c.ink } : { fontSize: 22, fontWeight: '400', color: c.ink },
                    headerLargeTitleStyle: { color: c.ink },
                    contentStyle: { backgroundColor: c.bg },
                  }}
                />
              </Stack>
            </NoticeProvider>
          </PlayerProvider>
        </SampleGate>
      </AppStateProvider>
    </ThemeProvider>
  );
}

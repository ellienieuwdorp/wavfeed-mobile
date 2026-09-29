/**
 * Root layout: the navigation theme built from our tokens (DESIGN-UI section 6), light and dark following the system
 * or Settings > Appearance (see `setAppearance`), the status bar styled from the same tokens because expo-status-bar's
 * `auto` reads React Native's scheme, which learns of a pick a native round trip later, the app state with its gather
 * runner and schedule (task 0036 decision 4), the player and notice state, and a stack holding the tabs, the player
 * sheet, the Bought by sheet and the Connect Bandcamp modal (task 0036 decision 5). The first launch with no Fan held
 * presents Connect once by itself, and the usage ask follows it once (task 0038); the sharing provider under the app
 * state counts each screen from here, by its closed code, because native tab screens mount eagerly. A sample bundle
 * fills the store and gathers nothing (src/dev/useSampleData.ts). On
 * Android the window behind the edge-to-edge views takes the page tone too, so a sheet or the back gesture never shows
 * a white edge in dark. Error capture is installed as this module loads, and its `ErrorBoundary` catches what a
 * tab's screen boundary does not (task 0038 decision 10).
 */
import { DarkTheme, DefaultTheme, Stack, ThemeProvider, usePathname, type Theme } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { setBackgroundColorAsync } from 'expo-system-ui';
import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';

import { AppFailed } from '@/components/Failed';
import { FirstRunAsk } from '@/components/FirstRunAsk';
import { FirstRunConnect } from '@/components/FirstRunConnect';
import { NoticeProvider } from '@/components/noticeState';
import { PlayerProvider } from '@/components/player/playerState';
import { copy } from '@/copy';
import { SAMPLE_MODE } from '@/dev/sampleMode';
import { SampleGate } from '@/dev/useSampleData';
import { AppStateProvider } from '@/state/appState';
import { GatherSchedule, runner } from '@/state/gather';
import { errorReports, installErrorCapture } from '@/tally/errors';
import { SharingProvider, useSharing } from '@/tally/Sharing';
import { screenFor } from '@/tally/tally';
import { useTokens } from '@/theme/tokens';

const ios = Platform.OS === 'ios';

installErrorCapture();

/** A render error bypasses the global handler, so the root boundary reports it (src/tally/errors.ts). */
export const ErrorBoundary = AppFailed;

/**
 * One `screen_viewed` per pathname change while sharing is on; the ask itself is never counted, it shows only before a
 * yes. An Error Report names the same screen.
 */
function ScreenTally() {
  const pathname = usePathname();
  const { sharing, track } = useSharing();
  const last = useRef<string | null>(null);
  const on = sharing !== null;
  useEffect(() => errorReports.setScreen(screenFor(pathname)), [pathname]);
  useEffect(() => {
    if (!on) {
      last.current = null;
      return;
    }
    if (pathname === last.current || pathname === '/usage') return;
    last.current = pathname;
    track({ name: 'screen_viewed', props: { screen: screenFor(pathname) } });
  }, [on, pathname, track]);
  return null;
}

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
          <SharingProvider>
            <GatherSchedule />
            <FirstRunConnect>{(pushed) => <FirstRunAsk connectPushed={pushed} />}</FirstRunConnect>
            <ScreenTally />
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
                    name="usage"
                    options={
                      ios
                        ? { presentation: 'formSheet', sheetAllowedDetents: 'fitToContents', sheetGrabberVisible: true, contentStyle: { backgroundColor: c.surface } }
                        : { presentation: 'modal', contentStyle: { backgroundColor: c.bg } }
                    }
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
          </SharingProvider>
        </SampleGate>
      </AppStateProvider>
    </ThemeProvider>
  );
}

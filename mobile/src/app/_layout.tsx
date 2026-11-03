/**
 * Root layout: the navigation theme built from our tokens (DESIGN-UI section 6), light and dark following the system
 * or Settings > Appearance (see `setAppearance`), the status bar styled from the same tokens because expo-status-bar's
 * `auto` reads React Native's scheme, which learns of a pick a native round trip later, the app state with its gather
 * runner and schedule, the player and notice state, and a stack holding the tabs, the player
 * sheet, the Bought by sheet and the Connect Bandcamp modal. While the store holds no Fan the
 * stack guards everything but the first screen and Connect, so the first screen is the whole app until a sign-in or
 * the Demo writes one, and the usage ask follows a sign-in once; the sharing provider under the app
 * state counts each screen from here, by its closed code, because native tab screens mount eagerly. A sample bundle
 * fills the store and gathers nothing (src/dev/useSampleData.ts). On
 * Android the window behind the edge-to-edge views takes the page tone too, so a sheet or the back gesture never shows
 * a white edge in dark. Everything sits under react-native-gesture-handler's root view, which the row's wishlist swipe
 * needs. On iOS 26 a cover in the page colour hides a launch until the tab bar's
 * accessory has drawn (`launchCover.tsx`). Error capture is installed as this module loads, and
 * its `ErrorBoundary` catches what a tab's screen boundary does not.
 */
import { DarkTheme, DefaultTheme, Stack, ThemeProvider, usePathname, type Theme } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { setBackgroundColorAsync } from 'expo-system-ui';
import { useEffect, useRef, type ReactNode } from 'react';
import { Platform, PlatformColor } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { AppFailed } from '@/components/Failed';
import { FirstRunAsk } from '@/components/FirstRunAsk';
import { NoticeProvider } from '@/components/noticeState';
import { LaunchCover } from '@/components/player/launchCover';
import { PlayerProvider } from '@/components/player/playerState';
import { copy } from '@/copy';
import { sampleRig } from '@/dev/rig';
import { SAMPLE_MODE } from '@/dev/sampleMode';
import { AppStateProvider, useAppState } from '@/state/appState';
import { GatherSchedule, runner } from '@/state/gather';
import { errorReports, installErrorCapture } from '@/tally/errors';
import { SharingProvider, useSharing } from '@/tally/Sharing';
import { screenFor } from '@/tally/tally';
import { useTokens } from '@/theme/tokens';

const ios = Platform.OS === 'ios';

const SampleGate = sampleRig?.SampleGate ?? (({ children }: { children: ReactNode }) => children);

installErrorCapture();

/** A render error bypasses the global handler, so the root boundary reports it (src/tally/errors.ts). */
export const ErrorBoundary = AppFailed;

const UNCOUNTED = new Set(['/usage', '/filters']);

/**
 * One `screen_viewed` per pathname change while sharing is on; the ask itself is never counted, it shows only before a
 * yes, and nor is New releases' Filters sheet. An Error Report names the same screen.
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
    // The ask and the Filters sheet are never counted.
    if (pathname === last.current || UNCOUNTED.has(pathname)) return;
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
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: c.bg }}>
      <ThemeProvider value={theme}>
        <AppStateProvider runner={SAMPLE_MODE ? undefined : runner}>
          <SampleGate>
            <SharingProvider>
              <GatherSchedule />
              <FirstRunAsk />
              <ScreenTally />
              <PlayerProvider>
                <NoticeProvider>
                  <StatusBar style={dark ? 'light' : 'dark'} />
                  <GuardedStack />
                  <LaunchCover />
                </NoticeProvider>
              </PlayerProvider>
            </SharingProvider>
          </SampleGate>
        </AppStateProvider>
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}

/** The routes a phone with no Fan may not reach sit behind `hasFan`; the first screen only before one. */
function GuardedStack() {
  const { c, dark } = useTokens();
  const hasFan = useAppState().gather.identity !== null;
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Protected guard={!hasFan}>
        <Stack.Screen name="welcome" options={{ animation: 'fade', gestureEnabled: false }} />
      </Stack.Protected>
      <Stack.Protected guard={hasFan}>
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
        {/*
          The Filters sheet: on iOS non-modal at the medium detent, the list behind undimmed and
          live, dragged to full height; on Android a modal sheet at half the height over the scrim, expanding to full.
        */}
        <Stack.Screen
          name="filters"
          options={
            ios
              ? { presentation: 'formSheet', sheetAllowedDetents: [0.5, 1], sheetLargestUndimmedDetentIndex: 0, sheetGrabberVisible: true, contentStyle: { backgroundColor: PlatformColor('systemGroupedBackground') } }
              : { presentation: 'formSheet', sheetAllowedDetents: [0.5, 1], sheetCornerRadius: 28, contentStyle: { backgroundColor: dark ? c.surface : c.raised } }
          }
        />
        <Stack.Screen
          name="usage"
          options={{
            presentation: 'formSheet',
            sheetAllowedDetents: 'fitToContents',
            sheetGrabberVisible: true,
            sheetCornerRadius: ios ? undefined : 28,
            contentStyle: { backgroundColor: c.surface },
          }}
        />
      </Stack.Protected>
      <Stack.Screen
        name="connect"
        options={{
          presentation: 'modal',
          // Always shown: a modal whose header comes and goes remounts and drops its state.
          headerShown: true,
          title: copy.connect.host,
          headerLargeTitle: false,
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
  );
}

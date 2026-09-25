/**
 * Root layout: the navigation theme built from our tokens (DESIGN-UI section 6),
 * light and dark following the system, the player and notice state, and a stack
 * holding the tabs, the player sheet and the Connect Bandcamp modal (task 0036
 * decision 5).
 */
import { DarkTheme, DefaultTheme, Stack, ThemeProvider, type Theme } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Platform } from 'react-native';

import { NoticeProvider } from '@/components/noticeState';
import { PlayerProvider } from '@/components/player/playerState';
import { copy } from '@/copy';
import { useTokens } from '@/theme/tokens';

const ios = Platform.OS === 'ios';

export default function RootLayout() {
  const { dark, c } = useTokens();
  const base = dark ? DarkTheme : DefaultTheme;
  const theme: Theme = {
    ...base,
    dark,
    colors: { primary: c.accent, background: c.bg, card: c.raised, text: c.ink, border: c.border, notification: c.danger },
  };
  return (
    <ThemeProvider value={theme}>
      <PlayerProvider>
        <NoticeProvider>
          <StatusBar style="auto" />
          <Stack screenOptions={{ headerShown: false }}>
            <Stack.Screen name="(tabs)" />
            <Stack.Screen
              name="player"
              options={{
                presentation: 'formSheet',
                sheetAllowedDetents: [0.55, 1],
                sheetInitialDetentIndex: 'last',
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
                headerTintColor: c.accent,
                headerTitleStyle: ios ? { color: c.ink } : { fontSize: 22, fontWeight: '500', color: c.ink },
                headerLargeTitleStyle: { color: c.ink },
                contentStyle: { backgroundColor: c.bg },
              }}
            />
          </Stack>
        </NoticeProvider>
      </PlayerProvider>
    </ThemeProvider>
  );
}

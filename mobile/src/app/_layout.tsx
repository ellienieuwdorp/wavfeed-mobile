/**
 * Root layout: the navigation theme built from our tokens (DESIGN-UI section 6),
 * light and dark following the system, and a stack holding the tabs.
 */
import { DarkTheme, DefaultTheme, Stack, ThemeProvider, type Theme } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

import { useTokens } from '@/theme/tokens';

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
      <StatusBar style="auto" />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(tabs)" />
      </Stack>
    </ThemeProvider>
  );
}

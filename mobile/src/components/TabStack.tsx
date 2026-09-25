/**
 * The one-screen native stack each tab wraps its view in, so iOS gets the large
 * title and Android a plain 56dp app bar with a 22sp title (the v2 client
 * canvas, sections 6 and 7).
 */
import { Stack } from 'expo-router';
import { Platform } from 'react-native';

import { useTokens } from '@/theme/tokens';

export function TabStack({ title, raised = false }: { title: string; raised?: boolean }) {
  const { c } = useTokens();
  const background = raised && Platform.OS === 'ios' ? c.raised : c.bg;
  return (
    <Stack
      screenOptions={{
        headerLargeTitle: true,
        headerShadowVisible: false,
        headerLargeTitleShadowVisible: false,
        headerStyle: { backgroundColor: background },
        headerLargeStyle: { backgroundColor: background },
        headerTintColor: c.accent,
        headerTitleStyle: Platform.OS === 'android' ? { fontSize: 22, fontWeight: '500', color: c.ink } : { color: c.ink },
        headerLargeTitleStyle: { color: c.ink },
        contentStyle: { backgroundColor: background },
      }}
    >
      <Stack.Screen name="index" options={{ title }} />
    </Stack>
  );
}

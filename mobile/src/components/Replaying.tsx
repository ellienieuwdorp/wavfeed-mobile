/**
 * The launch replay's screen (review finding ARCH-1): once a replay after a parser change outlasts its first stretch,
 * the app state shows this in place of the app, with the share of documents folded as the catch-up's hairline. No
 * navigator is mounted yet, and expo-router hides the splash only when one is ready, so this hides it itself.
 */
import { SplashScreen } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { Platform, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CatchUpHairline, progressValue } from '@/components/CatchUp';
import { copy } from '@/copy';
import { useTokens } from '@/theme/tokens';

const ios = Platform.OS === 'ios';

export function Replaying({ done, total }: { done: number; total: number }) {
  const { c, type, dark } = useTokens();
  const insets = useSafeAreaInsets();
  useEffect(() => {
    SplashScreen.hideAsync().catch(() => undefined);
  }, []);
  const fraction = total > 0 ? Math.min(done / total, 1) : 0;
  return (
    <View style={{ flex: 1, backgroundColor: c.bg, paddingTop: insets.top + 64, paddingHorizontal: type.gutter, gap: 12 }}>
      <StatusBar style={dark ? 'light' : 'dark'} />
      <Text accessibilityRole="header" style={ios ? { fontSize: 22, fontWeight: '700', color: c.ink } : { fontSize: 24, lineHeight: 32, color: c.ink }}>
        {copy.replay.title}
      </Text>
      <Text style={{ fontSize: type.body, lineHeight: 22, color: c.sub }}>{copy.replay.body}</Text>
      <View accessibilityRole="progressbar" accessibilityValue={progressValue(fraction)} style={{ paddingTop: 12, gap: 8 }}>
        <CatchUpHairline line={{ moving: true, fraction }} />
        <Text style={{ fontSize: type.body, color: c.sub }}>{copy.replay.done(Math.floor(fraction * 100))}</Text>
      </View>
    </View>
  );
}

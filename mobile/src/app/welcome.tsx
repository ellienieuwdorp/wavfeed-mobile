/**
 * The first screen (task 0044 decision 4): the whole screen while the store holds no Fan, since the root stack guards
 * every other route behind one (see `_layout.tsx`). The mark, one line on what wavfeed is, Sign in to Bandcamp, which
 * opens Bandcamp's own page as the Connect sheet, "Look around first", which loads the Demo (task 0043 decision 2), and
 * the one line that the sign-in stays on this phone. There is no way past it but those two: either one writes a Fan,
 * the guard lets the tabs in, and this screen goes.
 */
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useState } from 'react';
import { Platform, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { WideButton } from '@/components/WideButton';
import { copy } from '@/copy';
import { loadDemo } from '@/demo/demo';
import { useAppState } from '@/state/appState';
import { loadGatherState } from '@/state/gatherSink';
import { connectHref } from '@/tally/actions';
import { useTokens } from '@/theme/tokens';

const ios = Platform.OS === 'ios';
/** The bare W in white on nothing (docs/design/2026-09-29-waveform-icon), tinted with the accent of the theme in force. */
const MARK = require('../../assets/images/splash-icon.png');
const MARK_WIDTH = 88;
const MARK_HEIGHT = Math.round((MARK_WIDTH * 138) / 300);

export default function Welcome() {
  const { c, type } = useTokens();
  const insets = useSafeAreaInsets();
  const app = useAppState();
  const [loading, setLoading] = useState(false);
  const w = copy.welcome;

  const lookAround = () => {
    setLoading(true);
    void (async () => {
      await loadDemo(app.db);
      // The Demo Fan in the gather state is what opens the guard.
      await loadGatherState(app);
      app.invalidate();
    })()
      .catch((error: unknown) => console.warn('the Demo did not load:', error instanceof Error ? error.message : String(error)))
      .finally(() => setLoading(false));
  };

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: c.bg }}
      contentContainerStyle={{ flexGrow: 1, paddingHorizontal: type.gutter, paddingTop: insets.top + (ios ? 56 : 48), paddingBottom: insets.bottom + 20 }}
    >
      <Image source={MARK} tintColor={c.accent} accessible accessibilityLabel={w.mark} style={{ width: MARK_WIDTH, height: MARK_HEIGHT }} />
      <View style={{ paddingTop: 28, gap: 10 }}>
        <Text accessibilityRole="header" style={ios ? { fontSize: 28, fontWeight: '700', color: c.ink } : { fontSize: 28, lineHeight: 36, color: c.ink }}>
          {w.title}
        </Text>
        <Text style={{ fontSize: 17, lineHeight: 24, color: c.sub }}>{w.sub}</Text>
      </View>
      <View style={{ flex: 1, minHeight: 40 }} />
      <View style={{ gap: 10 }}>
        <WideButton label={w.signIn} kind="filled" onPress={() => router.push(connectHref('first_run'))} />
        <WideButton label={w.lookAround} kind="tonal" busy={loading} onPress={lookAround} />
      </View>
      <Text style={{ fontSize: type.fact, lineHeight: 18, color: c.sub, textAlign: 'center', paddingTop: 16 }}>{w.custody}</Text>
    </ScrollView>
  );
}

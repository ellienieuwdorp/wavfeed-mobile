/**
 * Connect Bandcamp (the v2 client canvas, task 0036 decision 1): the lead, the
 * custody paragraph, and two buttons. "Not now" closes it; Settings reopens it.
 * The sign-in press is a placeholder until the session lane puts its WebView there.
 */
import { router } from 'expo-router';
import { Platform, Pressable, ScrollView, Text } from 'react-native';

import { copy } from '@/copy';
import { useTokens } from '@/theme/tokens';

const ios = Platform.OS === 'ios';

function Button({ label, filled, onPress }: { label: string; filled: boolean; onPress: () => void }) {
  const { c } = useTokens();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={{ minHeight: ios ? 52 : 48, alignItems: 'center', justifyContent: 'center', borderRadius: ios ? 16 : 24, backgroundColor: filled ? c.accent : undefined }}
    >
      <Text style={{ fontSize: ios ? 17 : 15, fontWeight: ios ? '600' : '500', color: filled ? c.onAccent : c.accent }}>{label}</Text>
    </Pressable>
  );
}

export default function Connect() {
  const { c, type } = useTokens();
  const signIn = () => {};
  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ paddingHorizontal: type.gutter, paddingTop: 8, paddingBottom: 40, gap: 14 }}>
      <Text style={{ fontSize: 16, lineHeight: 22, color: c.ink }}>{copy.connect.lead}</Text>
      <Text style={{ fontSize: ios ? 15 : 14, lineHeight: ios ? 21 : 20, color: c.sub }}>{copy.connect.custody}</Text>
      <Button label={copy.connect.signIn} filled onPress={signIn} />
      <Button label={copy.connect.notNow} filled={false} onPress={() => router.back()} />
    </ScrollView>
  );
}

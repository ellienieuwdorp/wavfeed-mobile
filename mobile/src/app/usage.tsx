/**
 * The usage ask (task 0038 decision 3, ADR-0021): what sharing sends, what it never sends and where it goes, then
 * "Yes, send counts" and "Not now" as two buttons of the same size. Anything but the yes, a swipe down or back
 * included, leaves sharing off. A form sheet sized to its content on iOS, a modal on Android. `FirstRunAsk` presents it.
 */
import { router } from 'expo-router';
import { Platform, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { WideButton } from '@/components/WideButton';
import { copy } from '@/copy';
import { useSharing } from '@/tally/Sharing';
import { useTokens } from '@/theme/tokens';

const ios = Platform.OS === 'ios';
const a = copy.usageAsk;

function close(): void {
  if (router.canGoBack()) router.back();
  else router.replace('/');
}

export default function Usage() {
  const { c, type } = useTokens();
  const insets = useSafeAreaInsets();
  const { turnOn } = useSharing();
  const yes = () => {
    close();
    void turnOn().catch(() => undefined);
  };
  const [lead, ...rest] = a.body;
  return (
    <ScrollView
      style={{ flexGrow: 0, backgroundColor: ios ? c.surface : c.bg }}
      contentContainerStyle={{ paddingHorizontal: type.gutter, paddingTop: ios ? 28 : insets.top + 24, paddingBottom: ios ? insets.bottom : insets.bottom + 24, gap: 12 }}
    >
      <Text accessibilityRole="header" style={ios ? { fontSize: 22, fontWeight: '700', color: c.ink } : { fontSize: 24, lineHeight: 32, color: c.ink }}>
        {a.title}
      </Text>
      <Text style={{ fontSize: type.body, lineHeight: 22, color: c.ink }}>{lead}</Text>
      {rest.map((text) => (
        <Text key={text} style={{ fontSize: ios ? 15 : 14, lineHeight: ios ? 21 : 20, color: c.sub }}>
          {text}
        </Text>
      ))}
      <View style={{ gap: 10, paddingTop: 12 }}>
        <WideButton label={a.yes} kind="filled" onPress={yes} />
        <WideButton label={a.notNow} kind="tonal" onPress={close} />
      </View>
    </ScrollView>
  );
}

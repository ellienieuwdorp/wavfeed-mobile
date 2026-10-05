/**
 * The usage ask (task 0044 decision 3, task 0038 decision 1, ADR-0021): Ellie asking in her own voice, what a yes sends
 * and that nothing goes before it, what is never sent, a link to the privacy page for the rest, then "Yes, happy to help"
 * and "No thanks" as two buttons of one kind and size, so neither answer leans on the other. Anything but the yes, a swipe
 * down or back included, leaves sharing off. A form sheet sized to its content on both platforms, capped on Android
 * where Material's full-height sheet stops, as the Bought by sheet is. `FirstRunAsk` presents it after a sign-in.
 */
import { openURL } from 'expo-linking';
import { router } from 'expo-router';
import { Platform, Pressable, ScrollView, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Glyph } from '@/components/Glyph';
import { WideButton } from '@/components/WideButton';
import { copy, PRIVACY_COUNTS_URL } from '@/copy';
import { useSharing } from '@/tally/Sharing';
import { pressedOpacity, SHEET_TOP, useTokens } from '@/theme/tokens';

const ios = Platform.OS === 'ios';
const a = copy.usageAsk;

function close(): void {
  if (router.canGoBack()) router.back();
  else router.replace('/');
}

export default function Usage() {
  const { c, type } = useTokens();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const { turnOn } = useSharing();
  const yes = () => {
    close();
    void turnOn().catch(() => undefined);
  };
  const [lead, ...rest] = a.body;
  // Android's fitToContents sheet takes the content's full height and clips what passes the window, so the sheet is
  // capped where Material's full-height sheet stops and the words scroll inside it; its bottom pads over the nav bar.
  return (
    <ScrollView
      style={{ flexGrow: 0, maxHeight: ios ? undefined : height - insets.top - SHEET_TOP, backgroundColor: c.surface }}
      contentContainerStyle={{ paddingHorizontal: type.gutter, paddingTop: ios ? 28 : 24, paddingBottom: ios ? insets.bottom : insets.bottom + 24, gap: 12 }}
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
      <Pressable
        onPress={() => void openURL(PRIVACY_COUNTS_URL).catch(() => undefined)}
        accessibilityRole="link"
        hitSlop={8}
        style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 5, opacity: pressedOpacity(pressed) })}
      >
        <Text style={{ fontSize: ios ? 15 : 14, lineHeight: ios ? 21 : 20, color: c.accentText }}>{a.link}</Text>
        <Glyph name="external" size={ios ? 12 : 16} weight="regular" colour={c.accentText} />
      </Pressable>
      <View style={{ gap: 10, paddingTop: 12 }}>
        <WideButton label={a.yes} kind="tonal" onPress={yes} />
        <WideButton label={a.no} kind="tonal" onPress={close} />
      </View>
    </ScrollView>
  );
}

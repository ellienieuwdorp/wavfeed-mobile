/**
 * The Bought by sheet (the v2 client canvas, sections 6 to 8): "Bought by" over the people you follow who bought a
 * Release, each with their face and username, pressing through to their own Bandcamp page. It closes DESIGN-UI section
 * 11's debt of touch users never learning who bought it. The avatar stack hands the Fans over as JSON in the `fans`
 * param (see `openBoughtBy`); anything in it that is not a Fan is dropped.
 */
import { openURL } from 'expo-linking';
import { useLocalSearchParams } from 'expo-router';
import { Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { FanFace } from '@/components/AvatarStack';
import { Glyph } from '@/components/Glyph';
import { copy } from '@/copy';
import type { ApiFanRef } from '@/domain/apiTypes';
import { fanPageUrl } from '@/lib/format';
import { PRESS_FLASH, ripple, useTokens } from '@/theme/tokens';

const ios = Platform.OS === 'ios';

function isFanRef(value: unknown): value is ApiFanRef {
  if (typeof value !== 'object' || value === null) return false;
  const fan: { [key: string]: unknown } = { ...value };
  return (
    typeof fan.fanId === 'string' &&
    typeof fan.username === 'string' &&
    fan.username !== '' &&
    (fan.name === null || typeof fan.name === 'string') &&
    (fan.imageId === null || typeof fan.imageId === 'string')
  );
}

function readFans(raw: string | string[] | undefined): readonly ApiFanRef[] {
  if (typeof raw !== 'string') return [];
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value) ? value.filter(isFanRef) : [];
  } catch {
    return [];
  }
}

function FanRow({ fan }: { fan: ApiFanRef }) {
  const { c, type } = useTokens();
  const name = fan.name?.trim() ?? '';
  return (
    <Pressable
      onPress={() => openURL(fanPageUrl(fan)).catch(() => undefined)}
      accessibilityRole="link"
      accessibilityLabel={copy.boughtBy.fanPage(fan.username)}
      android_ripple={ripple(c.track)}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: ios ? 12 : 16, minHeight: ios ? 56 : 64, paddingHorizontal: type.gutter, backgroundColor: pressed ? PRESS_FLASH : undefined })}
    >
      <FanFace fan={fan} size={ios ? 36 : 40} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text numberOfLines={1} style={{ fontSize: ios ? 17 : 16, color: c.ink }}>{fan.username}</Text>
        {name !== '' && name !== fan.username ? <Text numberOfLines={1} style={{ fontSize: type.sub, color: c.sub }}>{name}</Text> : null}
      </View>
      <Glyph name="external" size={ios ? 15 : 20} weight="regular" colour={c.faint} />
    </Pressable>
  );
}

export default function BoughtBy() {
  const { c } = useTokens();
  const { fans } = useLocalSearchParams<{ fans?: string }>();
  const insets = useSafeAreaInsets();
  const list = readFans(fans);
  return (
    <View style={{ backgroundColor: c.surface, paddingTop: ios ? 20 : 8, paddingBottom: insets.bottom + 12 }}>
      <Text
        accessibilityRole="header"
        style={ios ? { fontSize: 17, fontWeight: '600', color: c.ink, textAlign: 'center', paddingBottom: 12 } : { fontSize: 22, color: c.ink, paddingHorizontal: 24, paddingBottom: 12 }}
      >
        {copy.boughtBy.title}
      </Text>
      <ScrollView style={{ flexGrow: 0 }}>
        {list.map((fan) => (
          <FanRow key={fan.fanId} fan={fan} />
        ))}
      </ScrollView>
    </View>
  );
}

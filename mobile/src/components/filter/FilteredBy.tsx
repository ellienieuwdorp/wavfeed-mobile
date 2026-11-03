/**
 * "Filtered by 2+ you follow · ambient, dub" under New releases' title while a filter is active (CSS3's `.fby`): the filter glyph at 16, the words and a chevron on the tint, 32 high and fully rounded, its left edge
 * on the title's. It scrolls away with the title, and a tap opens the Filters sheet. Its place is `FilterLineSlot`.
 */
import { router } from 'expo-router';
import { Platform, Pressable } from 'react-native';

import { Glyph } from '@/components/Glyph';
import { Type } from '@/components/Type';
import { copy } from '@/copy';
import { pressedOpacity, ripple, useTokens } from '@/theme/tokens';

import { FILTERS_ROUTE } from './FilterButton';
import { PILL_HEIGHT } from './FilterLineSlot';

const ios = Platform.OS === 'ios';

export function FilteredBy({ text }: { text: string }) {
  const { c } = useTokens();
  return (
    <Pressable
      onPress={() => router.navigate(FILTERS_ROUTE)}
      accessibilityRole="button"
      accessibilityLabel={text}
      accessibilityHint={copy.filter.openHint}
      android_ripple={ripple(c.track)}
      style={({ pressed }) => ({
        alignSelf: 'flex-start',
        maxWidth: '100%',
        minHeight: PILL_HEIGHT,
        flexDirection: 'row',
        alignItems: 'center',
        gap: ios ? 6 : 7,
        paddingLeft: 10,
        paddingRight: 12,
        borderRadius: 16,
        overflow: 'hidden',
        backgroundColor: c.tint,
        opacity: pressedOpacity(pressed),
      })}
    >
      <Glyph name="filter" size={16} colour={c.accentText} />
      <Type numberOfLines={1} style={{ flexShrink: 1, fontSize: 14, lineHeight: 18, fontWeight: '500', color: c.accentText }}>
        {text}
      </Type>
      <Glyph name="expand" size={14} colour={c.accentText} />
    </Pressable>
  );
}

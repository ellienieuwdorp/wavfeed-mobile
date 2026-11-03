/**
 * New releases when the filter keeps nothing (the round-two empty board): "Nothing matches", the
 * filter named, and "Clear filters", which chooses nothing again: the people switch off at 2 and no tags, as the sheet's Clear does.
 */
import { Platform, Pressable, View } from 'react-native';

import { Glyph } from '@/components/Glyph';
import { Type } from '@/components/Type';
import { copy } from '@/copy';
import { NOTHING_CHOSEN } from '@/state/filterSettings';
import { useReleaseFilter } from '@/state/releaseFilter';
import { pressedOpacity, ripple, useTokens } from '@/theme/tokens';

const ios = Platform.OS === 'ios';

export function NothingMatches({ named }: { named: string }) {
  const { c } = useTokens();
  const { update } = useReleaseFilter();
  return (
    <View style={{ paddingVertical: 48, paddingHorizontal: 32, alignItems: 'center', gap: 10 }}>
      <View style={{ marginBottom: 6 }}>
        <Glyph name="filter" size={36} colour={c.faint} weight="regular" />
      </View>
      <Type accessibilityRole="header" style={{ fontSize: 17, fontWeight: '600', color: c.ink, textAlign: 'center' }}>
        {copy.filter.nothing}
      </Type>
      <Type style={{ fontSize: 15, lineHeight: 20, color: c.sub, textAlign: 'center' }}>{named}</Type>
      <Pressable
        onPress={() => update(NOTHING_CHOSEN)}
        accessibilityRole="button"
        android_ripple={ripple(c.track)}
        hitSlop={8}
        style={({ pressed }) => ({ minHeight: ios ? 44 : 40, paddingHorizontal: 12, justifyContent: 'center', borderRadius: 20, overflow: 'hidden', opacity: pressedOpacity(pressed) })}
      >
        <Type style={{ fontSize: 15, fontWeight: ios ? '600' : '500', color: c.accentText }}>{copy.filter.clear}</Type>
      </Pressable>
    </View>
  );
}

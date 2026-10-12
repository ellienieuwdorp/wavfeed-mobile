/**
 * The 56 filter circle beside the mini player on New releases, where the tab bar cannot hold it: Android's native
 * bar, and iOS before Liquid Glass (task 0071, decisions 3 and 5, the author's Open 1 answer). The filter glyph,
 * plain on the card's raised tonal surface with its elevation when off, the accent on the tint when on. A tap toggles
 * the filter; the first opens the sheet (see useFilterToggle). On iOS 26 the tab bar's trailing item is the circle.
 */
import { GlassView } from 'expo-glass-effect';
import { Platform, Pressable, View } from 'react-native';

import { Glyph } from '@/components/Glyph';
import { copy } from '@/copy';
import { CARD_SHADOW, ripple, useTokens } from '@/theme/tokens';

import { useFilterToggle } from './useFilterToggle';

const ios = Platform.OS === 'ios';
export const CIRCLE = 56;

export function FilterCircle() {
  const { c, dark } = useTokens();
  const { on, press } = useFilterToggle();
  const button = (
    <Pressable
      onPress={press}
      accessibilityRole="button"
      accessibilityLabel={copy.filter.toggle(on)}
      accessibilityHint={copy.filter.toggleHint}
      android_ripple={ripple(c.track)}
      style={{ width: CIRCLE, height: CIRCLE, borderRadius: CIRCLE / 2, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' }}
    >
      <Glyph name="filter" size={24} colour={on ? c.accent : ios ? c.ink : c.sub} weight={on ? 'bold' : 'regular'} />
    </Pressable>
  );
  const shape = { width: CIRCLE, height: CIRCLE, borderRadius: CIRCLE / 2 };
  if (ios) {
    return (
      <GlassView glassEffectStyle="regular" isInteractive tintColor={on ? c.tint : undefined} style={[shape, { backgroundColor: on ? c.tint : c.raised }]}>
        {button}
      </GlassView>
    );
  }
  return <View style={[shape, { backgroundColor: on ? c.tint : dark ? c.borderLight : c.surface, boxShadow: CARD_SHADOW }]}>{button}</View>;
}

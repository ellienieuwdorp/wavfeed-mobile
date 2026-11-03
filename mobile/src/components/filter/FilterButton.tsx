/**
 * New releases' filter button (replacing the earlier circle and the iOS
 * bar's trailing item): 56, at the bottom right of New releases and its Upcoming list only (see Dock). A tap always
 * opens the Filters sheet and changes nothing itself. On iOS a Liquid Glass circle with the system's filter symbol,
 * tinted with the accent glyph while a filter is active; without glass the same circle on the raised surface. On
 * Android Material 3's FAB, radius 16 at level 3, in the primary container (the tint) with the accent glyph, and a
 * small accent dot at the glyph's top right while a filter is active. It stands while the list scrolls: the iOS 26 bar
 * does not minimise on New releases (see the iOS tab layout), and Android's never collapses.
 */
import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import { router } from 'expo-router';
import { Platform, Pressable, View } from 'react-native';

import { Glyph } from '@/components/Glyph';
import { copy } from '@/copy';
import { isActive } from '@/state/filterSettings';
import { useReleaseFilter } from '@/state/releaseFilter';
import { FAB_SHADOW, pressedOpacity, ripple, useTokens } from '@/theme/tokens';

export const FILTERS_ROUTE = '/filters';

const ios = Platform.OS === 'ios';
const glass = ios && isLiquidGlassAvailable();
const BUTTON = 56;
/** Android's active mark, Material's small badge ringed in the FAB's own ground. */
const DOT = 9;

export function FilterButton() {
  const { c } = useTokens();
  const { settings } = useReleaseFilter();
  const active = isActive(settings);
  const glyph = <Glyph name="filter" size={ios ? 22 : 24} colour={active || !ios ? c.accent : c.ink} weight={active ? 'semibold' : 'medium'} />;
  const a11y = { accessibilityRole: 'button' as const, accessibilityLabel: copy.filter.button(active), accessibilityHint: copy.filter.openHint };
  const open = () => router.navigate(FILTERS_ROUTE);
  const radius = ios ? BUTTON / 2 : 16;
  let face;
  if (ios) {
    const button = (
      <Pressable onPress={open} {...a11y} style={({ pressed }) => ({ flex: 1, alignItems: 'center', justifyContent: 'center', opacity: glass ? 1 : pressedOpacity(pressed) })}>
        {glyph}
      </Pressable>
    );
    face = glass ? (
      <GlassView glassEffectStyle="regular" isInteractive tintColor={active ? c.tint : undefined} style={{ width: BUTTON, height: BUTTON, borderRadius: radius }}>
        {button}
      </GlassView>
    ) : (
      <View style={{ width: BUTTON, height: BUTTON, borderRadius: radius, backgroundColor: active ? c.tint : c.raised, boxShadow: '0 3px 6px rgba(0,0,0,0.18), 0 1px 3px rgba(0,0,0,0.12)' }}>{button}</View>
    );
  } else {
    face = (
      <View style={{ width: BUTTON, height: BUTTON, borderRadius: radius, backgroundColor: c.tint, boxShadow: FAB_SHADOW }}>
        <Pressable
          onPress={open}
          {...a11y}
          android_ripple={ripple(c.track)}
          style={{ flex: 1, borderRadius: radius, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' }}
        >
          {glyph}
          {active ? (
            <View style={{ position: 'absolute', top: 13, right: 13, width: DOT, height: DOT, borderRadius: DOT / 2, backgroundColor: c.accent, borderWidth: 1.5, borderColor: c.tint }} />
          ) : null}
        </Pressable>
      </View>
    );
  }
  return <View style={{ alignSelf: 'flex-end', marginRight: 16 }}>{face}</View>;
}

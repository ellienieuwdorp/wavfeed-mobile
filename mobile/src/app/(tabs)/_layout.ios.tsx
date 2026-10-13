/**
 * The three tabs on iOS as native tabs (task 0036 decision 5, task 0071 decision 1): UITabBarController, so iOS 26
 * draws the floating Liquid Glass bar with labels and shrinks it while scrolling down. Feed's crests and New releases'
 * calendar are template images with a selected state of their own, the gear the SF Symbol (decision 2), tinted with
 * the accent. The bar's bottom accessory carries the mini player once a Track exists; the catch-up lives in the
 * header (task 0040, decision 8). New releases' filter is the bar's detached trailing item (task 0071, decision 5, and
 * the author's Open 1 answer: stay native): a trigger with the search role, so iOS 26 draws it as its own glass circle
 * at the right and keeps it there, beside the inline player, when the bar minimises. Its route is a placeholder no tap
 * can reach, since the trigger is disabled: the native side refuses the selection and still emits `tabPress`, which
 * toggles the filter. The item shows while New releases is the focused tab, its pushed list included, and hides on
 * the others; expo-router keys the tab view on the set of visible triggers, which remounted every tab on each switch,
 * and `patches/expo-router+57.0.24.patch` drops that key on iOS (task 0071, decision 5 as amended).
 * Without Liquid Glass it stays hidden and the dock's circle stands in (see Dock).
 * Off it is the system's filter symbol; on, the drawn glyph in the accent on a disc of the tint, a colour image per
 * scheme. The tab host takes the token scheme as its own
 * `overrideUserInterfaceStyle`, set during the same Fabric mount as the token colours, so the glass, the headers'
 * scroll edge, the accessory, the SwiftUI controls and every PlatformColor inside the tabs flip in the frame the
 * literal colours do; left to the window's trait, they flipped a JS round trip early (see `setAppearance`).
 */
import { isLiquidGlassAvailable } from 'expo-glass-effect';
import { NativeTabs } from 'expo-router/unstable-native-tabs';
import { useState } from 'react';

import { ScreenFailed } from '@/components/Failed';
import { AccessoryPlayer, playerInAccessory } from '@/components/player/MiniPlayer';
import { usePlayerRelease } from '@/components/player/playerState';
import { useFilterToggle } from '@/components/filter/useFilterToggle';
import { FILTER_ON, TAB_GLYPHS } from '@/components/tabGlyphs';
import { copy } from '@/copy';
import { useTokens } from '@/theme/tokens';

/** Fixed for the app's life. */
const glass = isLiquidGlassAvailable();

/** A screen that throws while drawing shows its fallback under the tab bar (task 0038 decision 10). */
export const unstable_settings = { initialRouteName: '(feed)', screenErrorBoundary: ScreenFailed };

export default function TabsLayout() {
  const { c, dark } = useTokens();
  const current = usePlayerRelease();
  const accessory = playerInAccessory() && current !== null;
  const filter = useFilterToggle();
  // The focused tab by its screens' focus events, so the sheets over a tab leave the item as it was.
  const [focused, setFocused] = useState<string>(unstable_settings.initialRouteName);
  return (
    <NativeTabs
      tintColor={c.accent}
      minimizeBehavior="onScrollDown"
      unstable_nativeProps={{ colorScheme: dark ? 'dark' : 'light' }}
      screenListeners={({ route }) => ({ focus: () => setFocused(route.name) })}
    >
      {accessory ? (
        <NativeTabs.BottomAccessory>
          <AccessoryPlayer />
        </NativeTabs.BottomAccessory>
      ) : null}
      <NativeTabs.Trigger name="(feed)">
        <NativeTabs.Trigger.Icon src={TAB_GLYPHS.feed} renderingMode="template" />
        <NativeTabs.Trigger.Label>{copy.views.feed}</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="releases">
        <NativeTabs.Trigger.Icon src={TAB_GLYPHS.releases} renderingMode="template" />
        <NativeTabs.Trigger.Label>{copy.views.releases}</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger
        name="filter-toggle"
        role="search"
        disabled
        hidden={!glass || focused !== 'releases'}
        accessibilityLabel={copy.filter.toggle(filter.on)}
        listeners={{ tabPress: filter.press }}
      >
        {filter.on ? (
          <NativeTabs.Trigger.Icon src={dark ? FILTER_ON.dark : FILTER_ON.light} renderingMode="original" />
        ) : (
          <NativeTabs.Trigger.Icon sf="line.3.horizontal.decrease" />
        )}
        <NativeTabs.Trigger.Label>{copy.filter.title}</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="settings">
        <NativeTabs.Trigger.Icon sf={{ default: 'gearshape', selected: 'gearshape.fill' }} />
        <NativeTabs.Trigger.Label>{copy.views.settings}</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}

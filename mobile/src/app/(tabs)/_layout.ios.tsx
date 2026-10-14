/**
 * The three tabs on iOS as native tabs (task 0036 decision 5, task 0071 decision 1): UITabBarController, so iOS 26
 * draws the floating Liquid Glass bar with labels and shrinks it while scrolling down. Feed's crests and New releases'
 * calendar are template images with a selected state of their own, the gear the SF Symbol (decision 2), tinted with
 * the accent. The bar's bottom accessory carries the mini player once a Track exists; the catch-up lives in the
 * header (task 0040, decision 8). The bar minimises on scroll down except on New releases, where the filter button
 * floats above it (see Dock): the bar expands again only once a list is back at its top, so a button kept in step with
 * it would be gone for most of the list (task 0071, decision 5 as amended 2026-10-14). The tab host takes the token
 * scheme as its own
 * `overrideUserInterfaceStyle`, set during the same Fabric mount as the token colours, so the glass, the headers'
 * scroll edge, the accessory, the SwiftUI controls and every PlatformColor inside the tabs flip in the frame the
 * literal colours do; left to the window's trait, they flipped a JS round trip early (see `setAppearance`).
 */
import { NativeTabs } from 'expo-router/unstable-native-tabs';
import { useState } from 'react';

import { ScreenFailed } from '@/components/Failed';
import { AccessoryPlayer, playerInAccessory } from '@/components/player/MiniPlayer';
import { usePlayerRelease } from '@/components/player/playerState';
import { TAB_GLYPHS } from '@/components/tabGlyphs';
import { copy } from '@/copy';
import { useTokens } from '@/theme/tokens';

/** A screen that throws while drawing shows its fallback under the tab bar (task 0038 decision 10). */
export const unstable_settings = { initialRouteName: '(feed)', screenErrorBoundary: ScreenFailed };

export default function TabsLayout() {
  const { c, dark } = useTokens();
  const current = usePlayerRelease();
  const accessory = playerInAccessory() && current !== null;
  // The focused tab by its screens' focus events, so a sheet over a tab leaves the behaviour as it was.
  const [focused, setFocused] = useState<string>(unstable_settings.initialRouteName);
  return (
    <NativeTabs
      tintColor={c.accent}
      minimizeBehavior={focused === 'releases' ? 'never' : 'onScrollDown'}
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
      <NativeTabs.Trigger name="settings">
        <NativeTabs.Trigger.Icon sf={{ default: 'gearshape', selected: 'gearshape.fill' }} />
        <NativeTabs.Trigger.Label>{copy.views.settings}</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}

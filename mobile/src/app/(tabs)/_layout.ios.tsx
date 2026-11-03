/**
 * The three tabs on iOS as native tabs: UITabBarController, so iOS 26
 * draws the floating Liquid Glass bar with labels and shrinks it while scrolling down. Feed's crests and New releases'
 * calendar are template images with a selected state of their own, the gear the SF Symbol, tinted with
 * the accent. The bar's bottom accessory is mounted from launch, so iOS 26 runs the bar full width from the first
 * frame: it carries the restored or playing Release, else "Nothing playing", and a cover hides the launch until it
 * has drawn them (`launchCover.tsx`). The catch-up lives in the header. The bar minimises on scroll down except on New releases, where the filter button
 * floats above it (see Dock): the bar expands again only once a list is back at its top, so a button kept in step with
 * it would be gone for most of the list. The tab host takes the token
 * scheme as its own
 * `overrideUserInterfaceStyle`, set during the same Fabric mount as the token colours, so the glass, the headers'
 * scroll edge, the accessory, the SwiftUI controls and every PlatformColor inside the tabs flip in the frame the
 * literal colours do; left to the window's trait, they flipped a JS round trip early (see `setAppearance`).
 */
import { NativeTabs } from 'expo-router/unstable-native-tabs';
import { useState } from 'react';

import { ScreenFailed } from '@/components/Failed';
import { AccessoryLayout } from '@/components/player/launchCover';
import { AccessoryPlayer, playerInAccessory } from '@/components/player/MiniPlayer';
import { TAB_GLYPHS } from '@/components/tabGlyphs';
import { copy } from '@/copy';
import { useTokens } from '@/theme/tokens';

/** A screen that throws while drawing shows its fallback under the tab bar. */
export const unstable_settings = { initialRouteName: '(feed)', screenErrorBoundary: ScreenFailed };

export default function TabsLayout() {
  const { c, dark } = useTokens();
  const accessory = playerInAccessory();
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
          <AccessoryLayout>
            <AccessoryPlayer />
          </AccessoryLayout>
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

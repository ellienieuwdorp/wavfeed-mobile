/**
 * The three tabs on iOS as native tabs, so iOS 26 draws the floating Liquid Glass bar and shrinks it while scrolling,
 * except on New releases, whose filter button floats above it (see Dock). The bottom accessory is mounted from launch,
 * so the bar runs full width from the first frame, carrying the restored or playing Release or "Nothing playing"
 * under a cover until it has drawn (`launchCover.tsx`). The tab host takes the token scheme as its
 * `overrideUserInterfaceStyle` in the same Fabric mount as the token colours, so the glass, the accessory and every
 * PlatformColor inside flip in the frame the literal colours do (see `setAppearance`).
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

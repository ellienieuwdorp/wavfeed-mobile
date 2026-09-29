/**
 * The four tabs on iOS as native tabs (task 0036 decision 5): UITabBarController, so iOS 26 draws the floating Liquid
 * Glass bar with labels and shrinks it while scrolling down. SF Symbols in canvas order, filled when selected, tinted
 * with the accent. The bar's bottom accessory carries the mini player once a Track exists, and before that the
 * catch-up capsule while the first walk runs (see AccessoryContent). The tab host takes the token scheme as its own
 * `overrideUserInterfaceStyle`, set during the same Fabric mount as the token colours, so the glass, the headers'
 * scroll edge, the accessory, the SwiftUI controls and every PlatformColor inside the tabs flip in the frame the
 * literal colours do; left to the window's trait, they flipped a JS round trip early (see `setAppearance`).
 */
import { NativeTabs } from 'expo-router/unstable-native-tabs';

import { AccessoryContent } from '@/components/AccessoryContent';
import { useCatchUpLine } from '@/components/CatchUp';
import { ScreenFailed } from '@/components/Failed';
import { playerInAccessory } from '@/components/player/MiniPlayer';
import { usePlayerRelease } from '@/components/player/playerState';
import { copy } from '@/copy';
import { useTokens } from '@/theme/tokens';

/** A screen that throws while drawing shows its fallback under the tab bar (task 0038 decision 10). */
export const unstable_settings = { initialRouteName: '(feed)', screenErrorBoundary: ScreenFailed };

export default function TabsLayout() {
  const { c, dark } = useTokens();
  const current = usePlayerRelease();
  const catchUp = useCatchUpLine();
  const accessory = playerInAccessory() && (current !== null || catchUp !== null);
  return (
    <NativeTabs tintColor={c.accent} minimizeBehavior="onScrollDown" unstable_nativeProps={{ colorScheme: dark ? 'dark' : 'light' }}>
      {accessory ? (
        <NativeTabs.BottomAccessory>
          <AccessoryContent />
        </NativeTabs.BottomAccessory>
      ) : null}
      <NativeTabs.Trigger name="(feed)">
        <NativeTabs.Trigger.Icon sf="sparkles" />
        <NativeTabs.Trigger.Label>{copy.views.feed}</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="releases">
        <NativeTabs.Trigger.Icon sf={{ default: 'opticaldisc', selected: 'opticaldisc.fill' }} />
        <NativeTabs.Trigger.Label>{copy.views.releases}</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="bought">
        <NativeTabs.Trigger.Icon sf={{ default: 'bag', selected: 'bag.fill' }} />
        <NativeTabs.Trigger.Label>{copy.views.bought}</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="settings">
        <NativeTabs.Trigger.Icon sf={{ default: 'gearshape', selected: 'gearshape.fill' }} />
        <NativeTabs.Trigger.Label>{copy.views.settings}</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}

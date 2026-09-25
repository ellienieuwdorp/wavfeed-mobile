/**
 * The four tabs on iOS as native tabs (task 0036 decision 5): UITabBarController,
 * so iOS 26 draws the floating Liquid Glass bar with labels and shrinks it while
 * scrolling down. SF Symbols in canvas order, filled when selected, tinted with
 * the accent. The mini player is the bar's bottom accessory once a Track exists.
 */
import { NativeTabs } from 'expo-router/unstable-native-tabs';

import { AccessoryPlayer, playerInAccessory } from '@/components/player/MiniPlayer';
import { usePlayer } from '@/components/player/playerState';
import { copy } from '@/copy';
import { useTokens } from '@/theme/tokens';

export const unstable_settings = { initialRouteName: '(feed)' };

export default function TabsLayout() {
  const { c } = useTokens();
  const { current } = usePlayer();
  return (
    <NativeTabs tintColor={c.accent} minimizeBehavior="onScrollDown">
      {current && playerInAccessory() ? (
        <NativeTabs.BottomAccessory>
          <AccessoryPlayer />
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

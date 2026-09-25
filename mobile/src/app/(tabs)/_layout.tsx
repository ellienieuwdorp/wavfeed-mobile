/**
 * The four tabs on Android as native tabs (task 0036 decision 5, the v2 client canvas, section 7): Material's bottom
 * navigation with the pill indicator behind the active icon, Material Symbols in canvas order, labels always shown,
 * tinted with the accent. iOS uses `_layout.ios.tsx`. Each tab owns a stack for its app bar; the catch-up strip and
 * the floating player ride inside the tab's stack, above this bar (see TabStack).
 */
import { NativeTabs } from 'expo-router/unstable-native-tabs';

import { copy } from '@/copy';
import { useTokens } from '@/theme/tokens';

export const unstable_settings = { initialRouteName: '(feed)' };

export default function TabsLayout() {
  const { c } = useTokens();
  return (
    <NativeTabs
      tintColor={c.accent}
      backgroundColor={c.raised}
      indicatorColor={c.tint}
      iconColor={{ default: c.sub, selected: c.ink }}
      labelStyle={{ default: { color: c.sub, fontSize: 12, fontWeight: '500' }, selected: { color: c.ink, fontSize: 12, fontWeight: '500' } }}
      labelVisibilityMode="labeled"
      rippleColor={c.track}
      backBehavior="initialRoute"
    >
      <NativeTabs.Trigger name="(feed)">
        <NativeTabs.Trigger.Icon md="auto_awesome" />
        <NativeTabs.Trigger.Label>{copy.views.feed}</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="releases">
        <NativeTabs.Trigger.Icon md="album" />
        <NativeTabs.Trigger.Label>{copy.views.releases}</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="bought">
        <NativeTabs.Trigger.Icon md="shopping_bag" />
        <NativeTabs.Trigger.Label>{copy.views.bought}</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="settings">
        <NativeTabs.Trigger.Icon md="settings" />
        <NativeTabs.Trigger.Label>{copy.views.settings}</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}

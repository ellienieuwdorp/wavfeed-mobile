/**
 * The three tabs on Android as native tabs (task 0036 decision 5, task 0071 decision 1, the v2 client canvas, section
 * 7): Material's bottom navigation with the pill indicator behind the active icon and labels always shown. Feed's
 * crests and New releases' calendar are images with a selected state of their own, the gear the Material Symbol
 * (decision 2), all tinted by the bar. iOS uses `_layout.ios.tsx`. Each tab owns a stack for its app bar; the floating
 * player rides inside the tab's stack, above this bar (see TabStack), and on New releases shares its row with the
 * filter circle (task 0071, decision 3 as the Open 1 answer draws it on Android); the iOS bar's filter item has no
 * place here, so its placeholder route is hidden. The tab host takes the token scheme as its day or
 * night mode in the same mount as the bar's colours, so the configuration change `Appearance.setColorScheme` sends
 * cannot restyle the bar ahead of them.
 */
import { NativeTabs } from 'expo-router/unstable-native-tabs';

import { ScreenFailed } from '@/components/Failed';
import { TAB_GLYPHS } from '@/components/tabGlyphs';
import { copy } from '@/copy';
import { useTokens } from '@/theme/tokens';

/** A screen that throws while drawing shows its fallback under the tab bar (task 0038 decision 10). */
export const unstable_settings = { initialRouteName: '(feed)', screenErrorBoundary: ScreenFailed };

export default function TabsLayout() {
  const { c, dark } = useTokens();
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
      unstable_nativeProps={{ colorScheme: dark ? 'dark' : 'light' }}
    >
      <NativeTabs.Trigger name="(feed)">
        <NativeTabs.Trigger.Icon src={TAB_GLYPHS.feed} />
        <NativeTabs.Trigger.Label>{copy.views.feed}</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="releases">
        <NativeTabs.Trigger.Icon src={TAB_GLYPHS.releases} />
        <NativeTabs.Trigger.Label>{copy.views.releases}</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="filter-toggle" hidden />
      <NativeTabs.Trigger name="settings">
        <NativeTabs.Trigger.Icon md="settings" />
        <NativeTabs.Trigger.Label>{copy.views.settings}</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}

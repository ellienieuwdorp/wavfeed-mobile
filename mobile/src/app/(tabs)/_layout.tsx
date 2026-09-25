/**
 * The four tabs in canvas order, Feed first and initial, with Ionicons outline
 * when inactive and filled when active, tinted with the accent (the v2 client
 * canvas, sections 6 and 7). Each tab owns a stack for its native header.
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import type { ComponentProps } from 'react';
import Tabs from 'expo-router/js-tabs';

import { copy } from '@/copy';
import { useTokens } from '@/theme/tokens';

type IconName = ComponentProps<typeof Ionicons>['name'];

const TABS: { name: string; title: string; icon: IconName; iconOn: IconName }[] = [
  { name: '(feed)', title: copy.views.feed, icon: 'sparkles-outline', iconOn: 'sparkles' },
  { name: 'releases', title: copy.views.releases, icon: 'disc-outline', iconOn: 'disc' },
  { name: 'bought', title: copy.views.bought, icon: 'bag-outline', iconOn: 'bag' },
  { name: 'settings', title: copy.views.settings, icon: 'settings-outline', iconOn: 'settings' },
];

export const unstable_settings = { initialRouteName: '(feed)' };

export default function TabsLayout() {
  const { c } = useTokens();
  return (
    <Tabs screenOptions={{ headerShown: false, tabBarActiveTintColor: c.accent, tabBarInactiveTintColor: c.sub }}>
      {TABS.map((t) => (
        <Tabs.Screen
          key={t.name}
          name={t.name}
          options={{
            title: t.title,
            tabBarIcon: ({ focused, color, size }) => <Ionicons name={focused ? t.iconOn : t.icon} color={color} size={size} />,
          }}
        />
      ))}
    </Tabs>
  );
}

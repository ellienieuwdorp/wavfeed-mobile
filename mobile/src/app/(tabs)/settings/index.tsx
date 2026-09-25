/**
 * Settings in the canvas order: account, Bandcamp on this device, connected
 * devices, the one notification switch, appearance, password, Log out, and
 * Delete my account alone (the v2 client canvas). Only the switch and the
 * appearance picker respond; appearance overrides the system scheme.
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import type { ComponentProps } from 'react';
import { useState } from 'react';
import { Appearance, Platform, Pressable, ScrollView, Switch, Text, View } from 'react-native';

import { Segmented } from '@/components/Segmented';
import { Cell, Group, GroupFoot, GroupHead } from '@/components/SettingsList';
import { copy, sep } from '@/copy';
import { ACCOUNT, DEVICES, type DeviceKind } from '@/mock/data';
import { useTokens } from '@/theme/tokens';

const ios = Platform.OS === 'ios';
const s = copy.settings;

type Scheme = 'light' | 'dark' | 'system';

const DEVICE_ICON: Record<DeviceKind, ComponentProps<typeof Ionicons>['name']> = {
  phone: 'phone-portrait-outline',
  laptop: 'laptop-outline',
  browser: 'globe-outline',
};

function Chevron() {
  const { c } = useTokens();
  return ios ? <Ionicons name="chevron-forward" size={16} color={c.faint} /> : null;
}

export default function Settings() {
  const { c } = useTokens();
  const [announces, setAnnounces] = useState(true);
  const [scheme, setScheme] = useState<Scheme>('system');

  const pickScheme = (next: Scheme) => {
    setScheme(next);
    Appearance.setColorScheme(next === 'system' ? 'unspecified' : next);
  };

  const appearance = (
    <Segmented
      segments={[
        { key: 'light', label: s.appearance.light },
        { key: 'dark', label: s.appearance.dark },
        { key: 'system', label: s.appearance.system },
      ]}
      value={scheme}
      onChange={pickScheme}
    />
  );

  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ paddingTop: ios ? 8 : 0, paddingBottom: 40 }}>
      <Group>
        <Cell
          leading={
            <View style={{ width: ios ? 36 : 40, height: ios ? 36 : 40, borderRadius: 20, backgroundColor: c.avatarBg, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ fontSize: 13, fontWeight: '600', color: c.avatarInk }}>{ACCOUNT.initials}</Text>
            </View>
          }
          title={ACCOUNT.name}
          sub={ACCOUNT.email + sep + s.bandcampLabel + ACCOUNT.bandcamp}
        />
      </Group>

      <GroupHead label={s.thisDeviceHead} />
      <Group>
        <Cell
          leading={<View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: c.online }} />}
          title={s.signedInAs(ACCOUNT.bandcamp)}
          sub={ios ? undefined : ACCOUNT.gathered}
          trailing={ios ? <Text style={{ fontSize: 15, color: c.sub }}>{ACCOUNT.gathered}</Text> : undefined}
        />
        <Cell title={s.gatherNow} tone="accent" />
        <Cell title={s.signOut} tone="accent" />
      </Group>
      <GroupFoot text={s.custody} />

      <GroupHead label={s.devicesHead} />
      <Group>
        {DEVICES.map((d) => (
          <Cell
            key={d.name}
            leading={<Ionicons name={DEVICE_ICON[d.kind]} size={ios ? 18 : 20} color={c.sub} />}
            title={
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Text numberOfLines={1} style={{ flexShrink: 1, fontSize: 16, color: c.ink }}>{d.name}</Text>
                {d.current ? (
                  <Text style={{ fontSize: 11, fontWeight: '600', color: c.accent, backgroundColor: c.tint, paddingHorizontal: 6, borderRadius: 999, overflow: 'hidden' }}>{s.thisDevice}</Text>
                ) : null}
              </View>
            }
            sub={d.facts}
            trailing={
              d.current ? undefined : ios ? (
                <Chevron />
              ) : (
                <Pressable accessibilityRole="button" hitSlop={8}>
                  <Text style={{ fontSize: 14, fontWeight: '500', color: c.accent }}>{s.disconnect}</Text>
                </Pressable>
              )
            }
          />
        ))}
      </Group>

      <GroupHead label={s.notificationsHead} />
      <Group>
        <Cell
          title={s.announces}
          trailing={<Switch value={announces} onValueChange={setAnnounces} trackColor={ios ? undefined : { true: c.accent, false: c.border }} />}
        />
      </Group>

      <GroupHead label={s.appearanceHead} />
      {ios ? (
        <Group>
          <View style={{ padding: 8 }}>{appearance}</View>
        </Group>
      ) : (
        <View style={{ paddingHorizontal: 16, paddingBottom: 12 }}>{appearance}</View>
      )}

      <Group gapAbove>
        <Cell title={s.changePassword} trailing={<Chevron />} />
        <Cell title={s.logOut} tone="danger" />
      </Group>

      <Group gapAbove>
        <Cell title={s.deleteAccount} sub={ios ? undefined : s.deleteAccountNote} tone="danger" />
      </Group>
    </ScrollView>
  );
}

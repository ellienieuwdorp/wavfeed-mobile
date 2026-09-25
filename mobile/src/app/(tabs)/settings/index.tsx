/**
 * Settings in the canvas order, live on the store: the Bandcamp account, Bandcamp on this phone (status, Gather now,
 * sign out), connected devices (this one only until the v2 server knows the others), the one notification switch,
 * appearance, and removing everything gathered here. The wavfeed account rows (email, password, log out, delete) wait
 * for the account this slice does not have (task 0036).
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import * as Device from 'expo-device';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Alert, Appearance, Platform, ScrollView, Switch, Text, View } from 'react-native';

import { SignOutWebView } from '@/bandcamp/SignInWebView';
import { useDockClearance } from '@/components/player/Dock';
import { Segmented } from '@/components/Segmented';
import { Cell, Group, GroupFoot, GroupHead } from '@/components/SettingsList';
import { copy, sep } from '@/copy';
import { fanInitials } from '@/lib/format';
import { useNow } from '@/lib/useNow';
import { useAppState, useLiveQuery } from '@/state/appState';
import { turnRunning } from '@/state/gather';
import { DEVICE_ADDED_KEY, patchGather, readStoredIdentity } from '@/state/gatherSink';
import { countRawDocuments, readKv, readOverview } from '@/store';
import { useTokens } from '@/theme/tokens';

const ios = Platform.OS === 'ios';
const s = copy.settings;

type Scheme = 'light' | 'dark' | 'system';

function Chevron() {
  const { c } = useTokens();
  return ios ? <Ionicons name="chevron-forward" size={16} color={c.faint} /> : null;
}

function Dot({ colour }: { colour: string }) {
  return <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colour }} />;
}

function Avatar({ url, initials }: { url: string | null; initials: string }) {
  const { c } = useTokens();
  const size = ios ? 36 : 40;
  if (url !== null) return <Image source={{ uri: url }} style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: c.avatarBg }} />;
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: c.avatarBg, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ fontSize: 13, fontWeight: '600', color: c.avatarInk }}>{initials}</Text>
    </View>
  );
}

type Held = { documents: number; stories: number; releases: number; follows: number };

function heldLine(held: Held | null, lastError: string | null): string {
  if (held === null) return '';
  const facts = `${held.documents} pages held · ${held.stories} stories · ${held.releases} releases · ${held.follows} pages followed`;
  return lastError === null ? facts : `${facts} · last problem: ${lastError.replace('_', ' ')}`;
}

export default function Settings() {
  const { c } = useTokens();
  const app = useAppState();
  const facts = useLiveQuery<Held>(async (db) => {
    const o = await readOverview(db);
    return { documents: await countRawDocuments(db), stories: o.storyCount, releases: o.releaseCount, follows: o.followCount };
  });
  const { gather } = app;
  const now = useNow();
  const clearance = useDockClearance();
  const [announces, setAnnounces] = useState(true);
  const [scheme, setScheme] = useState<Scheme>('system');
  const [signingOut, setSigningOut] = useState(false);
  const [gathering, setGathering] = useState(false);
  const held = useLiveQuery(async (db) => ({
    identity: await readStoredIdentity(db),
    addedAt: await readKv<number>(db, DEVICE_ADDED_KEY),
  }));
  const identity = held?.identity ?? null;
  const connect = () => router.push('/connect');

  const status: 'connected' | 'signedOut' | 'notConnected' =
    identity === null || gather.pausedReason === 'not_connected' ? 'notConnected' : gather.pausedReason === 'logged_out' ? 'signedOut' : 'connected';
  const handle = identity === null ? '' : identity.username || identity.name || String(identity.fanId);
  const busy = gathering || gather.phase !== 'idle';
  const gatheredAgo = gather.lastSuccessAt === null ? s.notGatheredYet : s.gathered(gather.lastSuccessAt, now);

  const pickScheme = (next: Scheme) => {
    setScheme(next);
    Appearance.setColorScheme(next === 'system' ? 'unspecified' : next);
  };

  const gatherNow = () => {
    setGathering(true);
    void app
      .runGather('refresh')
      .catch(() => undefined)
      .finally(() => setGathering(false));
  };

  const finishSignOut = async () => {
    await app.session.signOut();
    await patchGather(app, { pausedReason: 'not_connected' });
    setSigningOut(false);
  };

  const removeAll = () =>
    Alert.alert(s.removeAllTitle, s.removeAllBody, [
      { text: s.cancel, style: 'cancel' },
      {
        text: s.removeAllConfirm,
        style: 'destructive',
        onPress: () => {
          void (async () => {
            await turnRunning()?.catch(() => undefined);
            await app.removeStore();
          })();
        },
      },
    ]);

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

  const statusCell =
    status === 'connected' ? (
      <Cell
        leading={<Dot colour={c.online} />}
        title={s.signedInAs(handle)}
        sub={ios ? undefined : gatheredAgo}
        trailing={ios ? <Text style={{ fontSize: 15, color: c.sub }}>{gatheredAgo}</Text> : undefined}
      />
    ) : status === 'signedOut' ? (
      <Cell
        leading={<Dot colour={c.wishlist} />}
        title={s.signedOut}
        sub={gather.lastSuccessAt === null ? undefined : s.lastGathered(gather.lastSuccessAt, now)}
        trailing={<Chevron />}
        onPress={connect}
      />
    ) : (
      <Cell leading={<Dot colour={c.faint} />} title={s.notConnected} sub={s.notGathering} />
    );

  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ paddingTop: ios ? 8 : 0, paddingBottom: 40 + clearance }}>
      {identity !== null ? (
        <Group>
          <Cell
            leading={<Avatar url={identity.avatarUrl} initials={fanInitials(identity.name ?? handle)} />}
            title={identity.name ?? handle}
            sub={s.bandcampLabel + handle}
          />
        </Group>
      ) : null}

      <GroupHead label={s.thisDeviceHead} />
      <Group>
        {statusCell}
        {status === 'connected' ? (
          <Cell
            title={s.gatherNow}
            tone="accent"
            sub={busy ? s.phase(gather.phase) || undefined : undefined}
            trailing={busy ? <ActivityIndicator size="small" /> : undefined}
            onPress={busy ? undefined : gatherNow}
          />
        ) : (
          <Cell title={s.signIn} tone="accent" onPress={connect} />
        )}
        {status === 'notConnected' ? null : <Cell title={s.signOut} tone="accent" onPress={signingOut ? undefined : () => setSigningOut(true)} />}
      </Group>
      <GroupFoot text={s.custody} />
      <GroupFoot text={heldLine(facts, gather.lastError)} />
      {signingOut ? <SignOutWebView onDone={() => void finishSignOut()} /> : null}

      <GroupHead label={s.devicesHead} />
      <Group>
        <Cell
          leading={<Ionicons name="phone-portrait-outline" size={ios ? 18 : 20} color={c.sub} />}
          title={
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Text numberOfLines={1} style={{ flexShrink: 1, fontSize: 16, color: c.ink }}>{Device.deviceName ?? s.deviceName}</Text>
              <Text style={{ fontSize: 11, fontWeight: '600', color: c.accent, backgroundColor: c.tint, paddingHorizontal: 6, borderRadius: 999, overflow: 'hidden' }}>{s.thisDevice}</Text>
            </View>
          }
          sub={[held?.addedAt != null ? s.added(new Date(held.addedAt), now) : null, gather.lastSuccessAt === null ? null : gatheredAgo].filter(Boolean).join(sep) || undefined}
        />
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
        <Cell title={s.removeAll} tone="danger" onPress={busy ? undefined : removeAll} />
      </Group>
    </ScrollView>
  );
}

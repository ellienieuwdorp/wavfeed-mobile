/**
 * Settings in the canvas order, live on the store: the Bandcamp account, Bandcamp on this phone (status, Gather now,
 * sign out), the usage switch with its sharing code and the privacy page (task 0038, hidden in a build that can never
 * send), connected devices (held back until a server knows the others), appearance, removing everything gathered here
 * (which sends `store_removed` first while sharing is on), and a feedback mail naming the build; the canvas's one
 * notification switch waits for notifications to exist. Android draws the status as one list item and its actions as
 * Material buttons under the custody line, as the canvas's Settings board does. A development build adds the store's
 * facts under the custody line. While something plays, the catch-up of a first walk sits under the large title as on
 * every tab (task 0040, decision 6). The wavfeed account rows (email, password, log out, delete) wait for the account
 * this slice does not have (task 0036).
 */
import * as Device from 'expo-device';
import { Image } from 'expo-image';
import { openURL } from 'expo-linking';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Platform, ScrollView, Text, View } from 'react-native';

import { SignOutWebView } from '@/bandcamp/SignInWebView';
import { useAppBar } from '@/components/AppBar';
import { Glyph } from '@/components/Glyph';
import { NativeSwitch } from '@/components/NativeSwitch';
import { useDockClearance } from '@/components/player/Dock';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Segmented } from '@/components/Segmented';
import { ButtonRow, Cell, Group, GroupFoot, GroupHead, ListButton } from '@/components/SettingsList';
import { copy, FEEDBACK_ADDRESS, PRIVACY_URL, sep } from '@/copy';
import { fanInitials } from '@/lib/format';
import { useNow } from '@/lib/useNow';
import { SAMPLE_MODE } from '@/dev/sampleMode';
import { useAppState, useLiveQuery } from '@/state/appState';
import { turnRunning } from '@/state/gather';
import { DEVICE_ADDED_KEY, patchGather, readStoredIdentity } from '@/state/gatherSink';
import { countRawDocuments, readKv, readOverview } from '@/store';
import { feedbackFacts, useSharing } from '@/tally/Sharing';
import { setAppearance, useAppearanceChoice, useTokens } from '@/theme/tokens';

const ios = Platform.OS === 'ios';
const s = copy.settings;
/** ceiling: one device is all this phone knows; show the block once the v2 server lists a Fan's devices (task 0036). */
const SHOW_DEVICES = false;
// ceiling: nothing here schedules or receives a notification (no expo-notifications), so the canvas's Notifications
// group with its one switch returns with push, between the devices and appearance.

/** On Android the dot sits in a 24dp icon slot, so its row's text starts at 56dp with the device row's. */
function Dot({ colour }: { colour: string }) {
  const slot = ios ? 8 : 24;
  return (
    <View style={{ width: slot, height: slot, alignItems: 'center', justifyContent: 'center' }}>
      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colour }} />
    </View>
  );
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

/** What the store holds, for the author's dev build only (task 0036); a release build draws nothing here. */
function heldLine(held: Held | null, lastError: string | null): string {
  if (!__DEV__ || held === null) return '';
  return copy.dev.held(held, lastError);
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
  const appBar = useAppBar();
  const scheme = useAppearanceChoice();
  const [signingOut, setSigningOut] = useState(false);
  const [gathering, setGathering] = useState(false);
  const held = useLiveQuery(async (db) => ({
    identity: await readStoredIdentity(db),
    addedAt: await readKv<number>(db, DEVICE_ADDED_KEY),
  }));
  const identity = held?.identity ?? null;
  const connect = () => router.push('/connect');
  const usage = useSharing();
  // The code an off just dropped stays in the foot until Settings is left, so the tester can still ask for erasure.
  const [droppedCode, setDroppedCode] = useState<string | null>(null);
  useFocusEffect(useCallback(() => () => setDroppedCode(null), []));
  const sharingOn = usage.sharing !== null;
  const setSharing = (on: boolean) => {
    if (on) {
      setDroppedCode(null);
      void usage.turnOn().catch(() => undefined);
    } else void usage.turnOff().then(setDroppedCode, () => undefined);
  };
  const usageFoot = usage.code !== null ? s.usageFoot(usage.code) : droppedCode !== null ? s.turnedOff(droppedCode) : s.usageFoot(null);
  const sendFeedback = () => {
    const query = `subject=${encodeURIComponent(s.feedbackSubject)}&body=${encodeURIComponent(s.feedbackBody(feedbackFacts(usage.code)))}`;
    openURL(`mailto:${FEEDBACK_ADDRESS}?${query}`).catch(() => undefined);
  };
  const version = feedbackFacts(null);

  const status: 'connected' | 'signedOut' | 'notConnected' =
    identity === null || gather.pausedReason === 'not_connected' ? 'notConnected' : gather.pausedReason === 'logged_out' ? 'signedOut' : 'connected';
  const handle = identity === null ? '' : identity.username || identity.name || String(identity.fanId);
  const busy = gathering || gather.phase !== 'idle';
  const gatheredAgo = gather.lastSuccessAt === null ? s.notGatheredYet : s.gathered(gather.lastSuccessAt, now);

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

  // The rig's sample Fan has no Bandcamp session to end, so its sign out skips the logout page (ADR-0001).
  const signOut = () => (SAMPLE_MODE ? void finishSignOut() : setSigningOut(true));

  const removeAll = () =>
    Alert.alert(s.removeAllTitle, s.removeAllBody, [
      { text: s.cancel, style: 'cancel' },
      {
        text: s.removeAllConfirm,
        style: 'destructive',
        onPress: () => {
          void (async () => {
            await turnRunning()?.catch(() => undefined);
            await usage.trackAndFlush({ name: 'store_removed', props: {} });
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
      onChange={setAppearance}
    />
  );

  const statusCell =
    status === 'connected' ? (
      <Cell
        leading={<Dot colour={c.online} />}
        title={s.signedInAs(handle)}
        sub={ios ? undefined : (busy && s.phase(gather.phase)) || gatheredAgo}
        trailing={ios ? <Text style={{ fontSize: 15, color: c.sub }}>{gatheredAgo}</Text> : undefined}
      />
    ) : status === 'signedOut' ? (
      <Cell
        leading={<Dot colour={c.wishlist} />}
        title={s.signedOut}
        sub={gather.lastSuccessAt === null ? undefined : s.lastGathered(gather.lastSuccessAt, now)}
        navigates
        onPress={connect}
      />
    ) : (
      <Cell leading={<Dot colour={c.faint} />} title={s.notConnected} sub={s.notGathering} />
    );

  return (
    <ScrollView {...appBar.scroll} contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ paddingTop: ios ? 16 : 0, paddingBottom: 40 + clearance }}>
      <ScreenHeader quiet />
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
      {ios ? (
        <>
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
            {status === 'notConnected' ? null : <Cell title={s.signOut} tone="accent" onPress={signingOut ? undefined : signOut} />}
          </Group>
          <GroupFoot text={s.custody} />
        </>
      ) : (
        <>
          <Group>{statusCell}</Group>
          <GroupFoot text={s.custody} />
          <ButtonRow>
            {status === 'connected' ? (
              <ListButton label={s.gatherNow} kind="tonal" busy={busy} onPress={gatherNow} />
            ) : (
              <ListButton label={s.signIn} kind="filled" onPress={connect} />
            )}
            {status === 'notConnected' ? null : <ListButton label={s.signOut} kind="outlined" onPress={signingOut ? undefined : signOut} />}
          </ButtonRow>
        </>
      )}
      <GroupFoot text={heldLine(facts, gather.lastError)} />
      {signingOut ? <SignOutWebView onDone={() => void finishSignOut()} /> : null}

      {usage.canSend && usage.loaded ? (
        <>
          <GroupHead label={s.usageHead} />
          <Group>
            <Cell
              title={s.share}
              trailing={<NativeSwitch value={sharingOn} onChange={setSharing} label={s.share} />}
              ownsFocus={ios}
              role={ios ? undefined : 'switch'}
              checked={ios ? undefined : sharingOn}
              onPress={ios ? undefined : () => setSharing(!sharingOn)}
            />
            <Cell
              title={s.privacy}
              trailing={<Glyph name="external" size={ios ? 15 : 20} weight="regular" colour={c.faint} />}
              onPress={() => void openURL(PRIVACY_URL).catch(() => undefined)}
            />
          </Group>
          <GroupFoot text={usageFoot} />
        </>
      ) : null}

      {SHOW_DEVICES ? (
        <>
          <GroupHead label={s.devicesHead} />
          <Group>
            <Cell
              leading={<Glyph name="phone" size={ios ? 20 : 24} weight="regular" colour={c.sub} />}
              title={
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Text numberOfLines={1} style={{ flexShrink: 1, fontSize: ios ? 17 : 16, color: c.ink }}>{Device.deviceName ?? s.deviceName}</Text>
                  <Text style={{ fontSize: 11, fontWeight: '600', color: c.accent, backgroundColor: c.tint, paddingHorizontal: 6, borderRadius: 999, overflow: 'hidden' }}>{s.thisDevice}</Text>
                </View>
              }
              sub={[held?.addedAt != null ? s.added(new Date(held.addedAt), now) : null, gather.lastSuccessAt === null ? null : gatheredAgo].filter(Boolean).join(sep) || undefined}
            />
          </Group>
        </>
      ) : null}

      <GroupHead label={s.appearanceHead} />
      {ios ? (
        <Group>
          <View style={{ paddingHorizontal: 16, paddingVertical: 10 }}>{appearance}</View>
        </Group>
      ) : (
        <View style={{ paddingHorizontal: 16, paddingBottom: 12 }}>{appearance}</View>
      )}

      <Group gapAbove>
        <Cell title={s.removeAll} tone="danger" onPress={busy ? undefined : removeAll} />
      </Group>

      <Group gapAbove>
        <Cell title={s.feedback} tone="accent" onPress={sendFeedback} />
      </Group>
      <GroupFoot text={s.version(version.version, version.build)} />
    </ScrollView>
  );
}

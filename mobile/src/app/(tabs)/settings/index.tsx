/**
 * Settings in the canvas order, live on the store: the Bandcamp account, Bandcamp on this phone (status, Gather now,
 * sign out), the usage switch with its sharing code (task 0038, hidden in a build that can never send and in the
 * Demo), connected devices (held back until a server knows the others), appearance, removing everything gathered here
 * (which sends `store_removed` first while sharing is on; Gather now and Sign out are counted too), and a feedback
 * mail naming the build beside the privacy page, which every build shows (task 0044 decision 5, guideline 5.1.1(i));
 * the canvas's one notification switch waits for notifications to exist. Every foot is two sentences at most. Android draws the
 * status as one list item and its actions as Material buttons under the custody line, as the canvas's Settings board
 * does. A development build adds the store's facts under the custody line. The catch-up of a first walk sits under the
 * large title as on every tab (task 0040, decision 8). The wavfeed account rows (email,
 * password, log out, delete) wait for the account this slice does not have (task 0036). The Demo shows as a sample with Sign in and no account card or Sign out (task 0043, decision 7).
 */
import * as Device from 'expo-device';
import { Image } from 'expo-image';
import { openURL } from 'expo-linking';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Alert, PixelRatio, Platform, ScrollView, Text, View } from 'react-native';

import { SignOutWebView } from '@/bandcamp/SignInWebView';
import { useAppBar } from '@/components/AppBar';
import { Glyph } from '@/components/Glyph';
import { NativeSwitch } from '@/components/NativeSwitch';
import { useDockClearance } from '@/components/player/Dock';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Segmented } from '@/components/Segmented';
import { ButtonRow, Cell, Group, GroupFoot, GroupHead, ListButton } from '@/components/SettingsList';
import { copy, FEEDBACK_ADDRESS, PRIVACY_URL, sep } from '@/copy';
import { isDemoFan } from '@/demo/demo';
import { fanInitials, sizedImageUrl } from '@/lib/format';
import { useNow } from '@/lib/useNow';
import { SAMPLE_MODE } from '@/dev/sampleMode';
import { useAppState, useLiveQuery } from '@/state/appState';
import { turnRunning } from '@/state/gather';
import { DEVICE_ADDED_KEY, patchGather, readStoredIdentity } from '@/state/gatherSink';
import { countRawDocuments, readKv, readOverview } from '@/store';
import { connectHref } from '@/tally/actions';
import { feedbackFacts } from '@/tally/appFacts';
import { useSharing } from '@/tally/Sharing';
import { setAppearance, useAppearanceChoice, useTokens } from '@/theme/tokens';

const ios = Platform.OS === 'ios';
const s = copy.settings;
/** ceiling: one device is all this phone knows; show the block once the v2 server lists a Fan's devices (task 0036). */
const SHOW_DEVICES = false;
// ceiling: nothing here schedules or receives a notification (no expo-notifications), so the canvas's Notifications
// group with its one switch is left out. The upgrade is a local notification from a gather on the phone, which needs no
// server (review STRAT-13); no task holds it yet. The group then sits between the devices and appearance.

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
  if (url !== null) {
    // The stored address names Bandcamp's 50px size; the face asks for the one this screen draws (finding VIS-M3).
    const sized = sizedImageUrl(url, PixelRatio.getPixelSizeForLayoutSize(size));
    return <Image source={{ uri: sized }} style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: c.avatarBg }} />;
  }
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
  const connect = () => router.push(connectHref('settings'));
  const usage = useSharing();
  // The code an off just dropped stays in the foot until Settings is left, so the tester can still ask for erasure; an
  // off that did not land says so there, with the switch still on (review SEC-2).
  const [droppedCode, setDroppedCode] = useState<string | null>(null);
  const [offFailed, setOffFailed] = useState(false);
  // A sign-out that never reached Bandcamp says so in the custody foot until Settings is left (review REL-3).
  const [signOutUnreachable, setSignOutUnreachable] = useState(false);
  useFocusEffect(
    useCallback(
      () => () => {
        setDroppedCode(null);
        setOffFailed(false);
        setSignOutUnreachable(false);
      },
      [],
    ),
  );
  const sharingOn = usage.sharing !== null;
  const setSharing = (on: boolean) => {
    setOffFailed(false);
    if (on) {
      setDroppedCode(null);
      void usage.turnOn().catch(() => undefined);
    } else void usage.turnOff().then(setDroppedCode, () => setOffFailed(true));
  };
  const usageFoot = offFailed
    ? s.turnOffFailed
    : usage.code !== null
      ? s.usageFoot(usage.code)
      : droppedCode !== null
        ? s.turnedOff(droppedCode)
        : s.usageFoot(null);
  const sendFeedback = () => {
    const query = `subject=${encodeURIComponent(s.feedbackSubject)}&body=${encodeURIComponent(s.feedbackBody(feedbackFacts(usage.code)))}`;
    openURL(`mailto:${FEEDBACK_ADDRESS}?${query}`).catch(() => undefined);
  };
  const version = feedbackFacts(null);

  const status: 'connected' | 'signedOut' | 'notConnected' | 'demo' = isDemoFan(identity?.fanId)
    ? 'demo'
    : identity === null || gather.pausedReason === 'not_connected'
      ? 'notConnected'
      : gather.pausedReason === 'logged_out'
        ? 'signedOut'
        : 'connected';
  const handle = identity === null ? '' : identity.username || identity.name || String(identity.fanId);
  const busy = gathering || gather.phase !== 'idle';
  const gatheredAgo = gather.lastSuccessAt === null ? s.notGatheredYet : s.gathered(gather.lastSuccessAt, now);

  const gatherNow = () => {
    setGathering(true);
    usage.track({ name: 'feed_refreshed', props: { from: 'gather_now', hit_ceiling: false } });
    void app
      .runGather('refresh')
      .catch(() => undefined)
      .finally(() => setGathering(false));
  };

  // A logout Bandcamp never answered leaves the session in the jar, so the phone stays as it was (review REL-3).
  const finishSignOut = async () => {
    const result = await app.session.signOut();
    usage.track({ name: 'signed_out', props: { result } });
    if (result === 'ok') await patchGather(app, { pausedReason: 'not_connected' });
    setSignOutUnreachable(result === 'unreachable');
    setSigningOut(false);
  };

  // The rig's sample Fan has no Bandcamp session to end, so its sign out skips the logout page (ADR-0001).
  const signOut = () => (SAMPLE_MODE ? void finishSignOut() : setSigningOut(true));

  // Pressable mid-gather too (finding FLOW-6): the count goes first, then the turn on the wire is waited out and the
  // store closed straight after it, so the chain's next store call fails and ends it (gather.ts `runner`). A second
  // confirm while one runs does nothing.
  const removing = useRef(false);
  const removeAll = () =>
    Alert.alert(s.removeAllTitle, s.removeAllBody(status === 'connected'), [
      { text: s.cancel, style: 'cancel' },
      {
        text: s.removeAllConfirm,
        style: 'destructive',
        onPress: () => {
          if (removing.current) return;
          removing.current = true;
          void (async () => {
            await usage.trackAndFlush({ name: 'store_removed', props: {} });
            await turnRunning()?.catch(() => undefined);
            await app.removeStore();
          })().finally(() => {
            removing.current = false;
          });
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
    ) : status === 'demo' ? (
      <Cell leading={<Dot colour={c.faint} />} title={copy.demo.status} sub={copy.demo.statusSub} />
    ) : (
      <Cell leading={<Dot colour={c.faint} />} title={s.notConnected} sub={s.notGathering} />
    );
  const hasSignOut = status === 'connected' || status === 'signedOut';
  const custody = status === 'demo' ? copy.demo.foot : signOutUnreachable ? s.signOutUnreachable : s.custody;

  return (
    <ScrollView {...appBar.scroll} contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ paddingTop: ios ? 16 : 0, paddingBottom: 40 + clearance }}>
      <ScreenHeader quiet />
      {identity !== null && status !== 'demo' ? (
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
            {hasSignOut ? <Cell title={s.signOut} tone="accent" onPress={signingOut ? undefined : signOut} /> : null}
          </Group>
          <GroupFoot text={custody} />
        </>
      ) : (
        <>
          <Group>{statusCell}</Group>
          <GroupFoot text={custody} />
          <ButtonRow>
            {status === 'connected' ? (
              <ListButton label={s.gatherNow} kind="tonal" busy={busy} onPress={gatherNow} />
            ) : (
              <ListButton label={s.signIn} kind="filled" onPress={connect} />
            )}
            {hasSignOut ? <ListButton label={s.signOut} kind="outlined" onPress={signingOut ? undefined : signOut} /> : null}
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
        <Cell title={s.removeAll} tone="danger" onPress={removeAll} />
      </Group>

      <Group gapAbove>
        <Cell title={s.feedback} tone="accent" onPress={sendFeedback} />
        <Cell
          title={s.privacy}
          trailing={<Glyph name="external" size={ios ? 15 : 20} weight="regular" colour={c.faint} />}
          onPress={() => void openURL(PRIVACY_URL).catch(() => undefined)}
        />
      </Group>
      <GroupFoot text={s.version(version.version, version.build)} />
    </ScrollView>
  );
}

/**
 * Connect Bandcamp (the v2 client canvas, task 0036 decision 1): the lead, the custody paragraph and two buttons; the
 * sign-in press swaps in Bandcamp's own login page full-bleed under a bar with Cancel. Each time the page leaves
 * /login the probe asks who is signed in: a Fan this phone's feed does not belong to gets the refusal line and the page
 * stays; otherwise the identity is written, the modal closes and a turn starts. A page that fails to load raises its own
 * line over it. The rig's sample bundle never opens the login page (ADR-0001). Each visit counts the door it came
 * through (`connect_opened`) and ends in one `sign_in_finished`: signed in, else the last failure line the visit
 * showed, else closed (task 0038, `src/tally/actions.ts`).
 */
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, Text, View } from 'react-native';

import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SignInWebView } from '@/bandcamp/SignInWebView';
import { copy } from '@/copy';
import { SAMPLE_MODE } from '@/dev/sampleMode';
import { useAppState } from '@/state/appState';
import { patchGather, readStoredIdentity, writeIdentity } from '@/state/gatherSink';
import { Glyph } from '@/components/Glyph';
import { WideButton } from '@/components/WideButton';
import { connectFrom, failSignIn, finishSignIn, openSignIn, type SignInFailure, type SignInVisit } from '@/tally/actions';
import { useSharing } from '@/tally/Sharing';
import { pressedOpacity, ripple, useTokens } from '@/theme/tokens';

const ios = Platform.OS === 'ios';

/** The header's Cancel reads the tokens itself: `Stack.Screen` hands `headerLeft` over in a layout effect, one render late. */
function Cancel({ onCancel }: { onCancel: () => void }) {
  const { c } = useTokens();
  return ios ? (
    <Pressable onPress={onCancel} accessibilityRole="button" hitSlop={10} style={({ pressed }) => ({ opacity: pressedOpacity(pressed) })}>
      <Text style={{ fontSize: 17, color: c.accent }}>{copy.connect.cancel}</Text>
    </Pressable>
  ) : (
    <Pressable
      onPress={onCancel}
      accessibilityRole="button"
      accessibilityLabel={copy.connect.cancel}
      android_ripple={ripple(c.track, 20)}
      style={{ width: 48, height: 48, marginLeft: -12, alignItems: 'center', justifyContent: 'center' }}
    >
      <Glyph name="dismiss" size={24} colour={c.ink} />
    </Pressable>
  );
}

function close(): void {
  if (router.canGoBack()) router.back();
  else router.replace('/');
}

type Visit = { readonly fail: (failure: SignInFailure) => void; readonly signedIn: () => void };

/** The visit's two Tallies: the door at mount, and its one ending at a sign-in or when the screen goes. */
function useVisit(): Visit {
  const app = useAppState();
  const { track } = useSharing();
  const { from } = useLocalSearchParams<{ from?: string }>();
  const visit = useRef<SignInVisit | null>(null);
  const tally = useRef(track);
  useEffect(() => {
    tally.current = track;
  });
  const finish = useCallback((how: 'signed_in' | 'left') => {
    if (visit.current === null) return;
    const step = finishSignIn(visit.current, how, Date.now());
    visit.current = step.visit;
    if (step.tally !== null) tally.current(step.tally);
  }, []);
  const opening = useRef({ from, db: app.db, identity: app.gather.identity });
  useEffect(() => {
    // Once per visit, with what held when it opened: a sign-in moves the gather state under it.
    const { from: param, db, identity } = opening.current;
    const door = connectFrom(param);
    if (door !== null) tally.current({ name: 'connect_opened', props: { from: door } });
    visit.current = openSignIn(Date.now(), identity !== null);
    void readStoredIdentity(db).then(
      (held) => {
        if (held !== null && visit.current !== null && !visit.current.done) visit.current = { ...visit.current, hadIdentity: true };
      },
      () => undefined,
    );
    return () => finish('left');
  }, [finish]);
  return {
    fail: useCallback((failure: SignInFailure) => {
      if (visit.current !== null) visit.current = failSignIn(visit.current, failure);
    }, []),
    signedIn: useCallback(() => finish('signed_in'), [finish]),
  };
}

function SignIn({ onCancel, visit }: { onCancel: () => void; visit: Visit }) {
  const { c, type } = useTokens();
  const app = useAppState();
  const [line, setLine] = useState<string | null>(null);
  const probing = useRef(false);

  const onMaybeSignedIn = async (): Promise<void> => {
    if (probing.current) return;
    probing.current = true;
    try {
      const probe = await app.session.probeIdentity();
      if (probe.kind === 'logged_out') return;
      if (probe.kind !== 'ok') {
        visit.fail(probe.kind === 'unreachable' ? 'unreachable' : 'bandcamp_error');
        setLine(copy.connect.unreachable);
        return;
      }
      const held = await readStoredIdentity(app.db);
      if (held !== null && held.fanId !== probe.value.fanId) {
        visit.fail('other_fan_refused');
        setLine(copy.connect.refusal(probe.value.username, held.username || held.name || String(held.fanId)));
        return;
      }
      await writeIdentity(app.db, probe.value, Date.now());
      await patchGather(app, { identity: probe.value, pausedReason: null, lastError: null, lastStatus: null });
      app.invalidate();
      visit.signedIn();
      close();
      void app.runGather('open');
    } finally {
      probing.current = false;
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <Stack.Screen
        options={{
          title: copy.connect.host,
          headerLargeTitle: false,
          headerLeft: () => <Cancel onCancel={onCancel} />,
        }}
      />
      {line !== null ? (
        <Text accessibilityRole="alert" style={{ fontSize: type.fact, color: c.ink, backgroundColor: c.raised, paddingHorizontal: type.gutter, paddingVertical: 10 }}>
          {line}
        </Text>
      ) : null}
      <View style={{ flex: 1 }}>
        <SignInWebView
          onMaybeSignedIn={() => void onMaybeSignedIn()}
          onError={(failure) => {
            visit.fail(failure);
            setLine(copy.connect.pageFailed);
          }}
        />
      </View>
    </View>
  );
}

export default function Connect() {
  const { c, type } = useTokens();
  const insets = useSafeAreaInsets();
  const [signingIn, setSigningIn] = useState(false);
  const visit = useVisit();
  if (signingIn) return <SignIn onCancel={() => setSigningIn(false)} visit={visit} />;
  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ paddingHorizontal: type.gutter, paddingTop: 8, paddingBottom: 40 + (ios ? 0 : insets.bottom), gap: 14 }}>
      <Stack.Screen options={{ title: copy.connect.title, headerLargeTitle: ios, headerLeft: undefined }} />
      <Text style={{ fontSize: 16, lineHeight: 22, color: c.ink }}>{copy.connect.lead}</Text>
      <Text style={{ fontSize: ios ? 15 : 14, lineHeight: ios ? 21 : 20, color: c.sub }}>{copy.connect.custody}</Text>
      <WideButton label={copy.connect.signIn} kind="filled" onPress={SAMPLE_MODE ? close : () => setSigningIn(true)} />
      <WideButton label={copy.connect.notNow} kind="plain" onPress={close} />
    </ScrollView>
  );
}

/**
 * Connect Bandcamp (the v2 client canvas, task 0036 decision 1): the lead, the custody paragraph and two buttons; the
 * sign-in press swaps in Bandcamp's own login page full-bleed under a bar with Cancel. Each time the page leaves
 * /login the probe asks who is signed in: a Fan this phone's feed does not belong to gets the refusal line and the page
 * stays; otherwise the identity is written, the modal closes and a turn starts. The rig's sample bundle never opens the
 * login page (ADR-0001).
 */
import { router, Stack } from 'expo-router';
import { useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, Text, View } from 'react-native';

import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SignInWebView } from '@/bandcamp/SignInWebView';
import { copy } from '@/copy';
import { SAMPLE_MODE } from '@/dev/sampleMode';
import { useAppState } from '@/state/appState';
import { patchGather, readStoredIdentity, writeIdentity } from '@/state/gatherSink';
import { Glyph } from '@/components/Glyph';
import { pressedOpacity, ripple, useTokens } from '@/theme/tokens';

const ios = Platform.OS === 'ios';

function Button({ label, filled, onPress }: { label: string; filled: boolean; onPress: () => void }) {
  const { c } = useTokens();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      android_ripple={ripple(filled ? c.onAccent : c.track)}
      style={({ pressed }) => ({ minHeight: ios ? 52 : 48, alignItems: 'center', justifyContent: 'center', borderRadius: ios ? 16 : 24, overflow: ios ? undefined : 'hidden', backgroundColor: filled ? c.accent : undefined, opacity: pressedOpacity(pressed) })}
    >
      <Text style={{ fontSize: ios ? 17 : 15, fontWeight: ios ? '600' : '500', color: filled ? c.onAccent : c.accent }}>{label}</Text>
    </Pressable>
  );
}

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

function SignIn({ onCancel }: { onCancel: () => void }) {
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
        setLine(copy.connect.unreachable);
        return;
      }
      const held = await readStoredIdentity(app.db);
      if (held !== null && held.fanId !== probe.value.fanId) {
        setLine(copy.connect.refusal(probe.value.username, held.username || held.name || String(held.fanId)));
        return;
      }
      await writeIdentity(app.db, probe.value, Date.now());
      await patchGather(app, { identity: probe.value, pausedReason: null, lastError: null });
      app.invalidate();
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
        <SignInWebView onMaybeSignedIn={() => void onMaybeSignedIn()} />
      </View>
    </View>
  );
}

export default function Connect() {
  const { c, type } = useTokens();
  const insets = useSafeAreaInsets();
  const [signingIn, setSigningIn] = useState(false);
  if (signingIn) return <SignIn onCancel={() => setSigningIn(false)} />;
  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ paddingHorizontal: type.gutter, paddingTop: 8, paddingBottom: 40 + (ios ? 0 : insets.bottom), gap: 14 }}>
      <Stack.Screen options={{ title: copy.connect.title, headerLargeTitle: ios, headerLeft: undefined }} />
      <Text style={{ fontSize: 16, lineHeight: 22, color: c.ink }}>{copy.connect.lead}</Text>
      <Text style={{ fontSize: ios ? 15 : 14, lineHeight: ios ? 21 : 20, color: c.sub }}>{copy.connect.custody}</Text>
      <Button label={copy.connect.signIn} filled onPress={SAMPLE_MODE ? close : () => setSigningIn(true)} />
      <Button label={copy.connect.notNow} filled={false} onPress={close} />
    </ScrollView>
  );
}

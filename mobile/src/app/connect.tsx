/**
 * Connect Bandcamp: a sheet holding Bandcamp's own login page under a bar with Cancel, opened from each door that
 * names itself. After each page that settles off /login the probe asks who is signed in (`probeGate`, FLOW-5): another
 * phone's Fan gets the refusal line and the page stays, a sign-in from the Demo empties the store, and otherwise the
 * sheet closes, the identity is written and a turn starts. An unanswered probe or a failed page raises a line with
 * "Try again" (FLOW-18). The sample bundle never opens the login page (ADR-0001). Each visit counts its door
 * (`connect_opened`) and ends in one `sign_in_finished` (`src/tally/actions.ts`).
 */
import { Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform, Pressable, Text, View } from 'react-native';

import { SignInWebView } from '@/bandcamp/SignInWebView';
import { copy } from '@/copy';
import { isDemoFan } from '@/demo/fan';
import { SAMPLE_MODE } from '@/dev/sampleMode';
import { closeSheet } from '@/lib/sheet';
import { useAppState } from '@/state/appState';
import { patchGather, readStoredIdentity, writeIdentity } from '@/state/gatherSink';
import { emptyStore } from '@/store/schema';
import { Glyph } from '@/components/Glyph';
import { connectFrom, failSignIn, finishSignIn, openSignIn, type SignInFailure, type SignInVisit } from '@/tally/actions';
import { useSharing } from '@/tally/Sharing';
import { pressedOpacity, ripple, useTokens } from '@/theme/tokens';
import { beginWishlist, retireWishlist } from '@/wishlist/membership';

const ios = Platform.OS === 'ios';
/** The header's Cancel reads the tokens itself: `Stack.Screen` hands `headerLeft` over in a layout effect, one render late. */
function Cancel({ onCancel }: { onCancel: () => void }) {
  const { c } = useTokens();
  return ios ? (
    <Pressable onPress={onCancel} accessibilityRole="button" hitSlop={10} style={({ pressed }) => ({ opacity: pressedOpacity(pressed) })}>
      <Text style={{ fontSize: 17, color: c.accentText }}>{copy.connect.cancel}</Text>
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

/** A line over the page, with "Try again" when pressing it can help (findings FLOW-5, FLOW-18). */
type Line = { readonly text: string; readonly retry?: () => void };

function SignIn({ onCancel, visit }: { onCancel: () => void; visit: Visit }) {
  const { c, type } = useTokens();
  const app = useAppState();
  const [line, setLine] = useState<Line | null>(null);
  // A new key remounts the WebView, which loads the sign-in page afresh after one that failed (finding FLOW-5).
  const [page, setPage] = useState(0);
  const probing = useRef(false);
  // A page that settles while a probe runs asks once more after it, so the landing behind a detour is never dropped.
  const again = useRef(false);
  // A probe outlives a Cancel: once the sheet is gone it neither asks again nor closes, since a second router.back()
  // would pop the screen under the sheet. A Fan it finds is still written, as the session is already in the jar.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const retry = (work: () => void) => () => {
    setLine(null);
    work();
  };

  const onMaybeSignedIn = async (): Promise<void> => {
    if (probing.current) {
      again.current = true;
      return;
    }
    probing.current = true;
    again.current = false;
    let signedIn = false;
    try {
      const probe = await app.session.probeIdentity();
      if (probe.kind === 'logged_out') return;
      if (probe.kind !== 'ok') {
        visit.fail(probe.kind === 'unreachable' ? 'unreachable' : 'bandcamp_error');
        setLine({ text: copy.connect.unreachable, retry: retry(() => void onMaybeSignedIn()) });
        return;
      }
      let held = await readStoredIdentity(app.db);
      if (held !== null && isDemoFan(held.fanId)) {
        await retireWishlist(app.db);
        await emptyStore(app.db);
        beginWishlist(app.db);
        held = null;
      }
      if (held !== null && held.fanId !== probe.value.fanId) {
        visit.fail('other_fan_refused');
        setLine({ text: copy.connect.refusal(probe.value.username, held.username || held.name || String(held.fanId)) });
        return;
      }
      // The sheet goes before the Fan is written, so a first run's guard swaps the first screen for the tabs beneath it.
      signedIn = true;
      visit.signedIn();
      if (mounted.current) closeSheet();
      await writeIdentity(app.db, probe.value);
      await patchGather(app, { identity: probe.value, pausedReason: null, lastError: null, lastStatus: null });
      app.invalidate();
      void app.runGather('open');
    } finally {
      probing.current = false;
      // oxlint-disable-next-line typescript/no-unnecessary-condition -- a second call sets again.current while this one awaits
      if (again.current && !signedIn && mounted.current) void onMaybeSignedIn();
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
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: c.raised, paddingLeft: type.gutter, paddingRight: line.retry ? 4 : type.gutter }}>
          <Text accessibilityRole="alert" style={{ flex: 1, fontSize: type.fact, color: c.ink, paddingVertical: 10 }}>
            {line.text}
          </Text>
          {line.retry ? (
            <Pressable
              onPress={line.retry}
              accessibilityRole="button"
              android_ripple={ripple(c.track)}
              style={({ pressed }) => ({ minHeight: ios ? 44 : 48, justifyContent: 'center', paddingHorizontal: 12, opacity: pressedOpacity(pressed) })}
            >
              <Text style={{ fontSize: type.fact, fontWeight: '600', color: c.accentText }}>{copy.connect.tryAgain}</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
      <View style={{ flex: 1 }}>
        <SignInWebView
          key={page}
          onMaybeSignedIn={() => void onMaybeSignedIn()}
          onError={(failure) => {
            visit.fail(failure);
            setLine({ text: copy.connect.pageFailed, retry: retry(() => setPage((n) => n + 1)) });
          }}
        />
      </View>
    </View>
  );
}

export default function Connect() {
  const visit = useVisit();
  // The rig's sample Fan has no Bandcamp session to start, so the sheet closes at once (ADR-0001).
  useEffect(() => {
    if (SAMPLE_MODE) closeSheet();
  }, []);
  if (SAMPLE_MODE) return null;
  return <SignIn onCancel={closeSheet} visit={visit} />;
}

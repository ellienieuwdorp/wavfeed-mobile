/**
 * Bandcamp's own sign-in and sign-out pages in a WebView sharing the app's cookie jar: iOS
 * copies the WebView's cookies into `NSHTTPCookieStorage` under `sharedCookiesEnabled`, and Android's `CookieManager`
 * is already React Native's jar. Nothing here reads a cookie; the caller probes to learn whether sign-in took, as
 * often as `probeGate` says (finding FLOW-5).
 */
import { useEffect, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView } from 'react-native-webview';

import { useTokens } from '@/theme/tokens';

import { probeGate, type ProbeGate } from './signInProbe';

export const BANDCAMP_LOGIN_URL = 'https://bandcamp.com/login';
export const BANDCAMP_LOGOUT_URL = 'https://bandcamp.com/logout';

/** Why the sign-in page did not show: a code, never the WebView's description (ADR-0003). */
export type SignInFailure = 'page_failed';

type SignInProps = {
  /** Called once for each page that settles anywhere but `/login`. */
  readonly onMaybeSignedIn: () => void;
  /** Called when a load fails below HTTP (offline, no DNS, TLS); redirects the WebView cancels do not count. */
  readonly onError: (failure: SignInFailure) => void;
};

export function SignInWebView({ onMaybeSignedIn, onError }: SignInProps) {
  const { c } = useTokens();
  const latest = useRef(onMaybeSignedIn);
  useEffect(() => {
    latest.current = onMaybeSignedIn;
  });
  const gate = useRef<ProbeGate | null>(null);
  useEffect(() => {
    const opened = probeGate(() => latest.current());
    gate.current = opened;
    return () => {
      opened.cancel();
      gate.current = null;
    };
  }, []);
  return (
    <WebView
      source={{ uri: BANDCAMP_LOGIN_URL }}
      sharedCookiesEnabled
      thirdPartyCookiesEnabled
      onNavigationStateChange={(state) => gate.current?.navigated(state)}
      onError={() => onError('page_failed')}
      // The library's error view prints the platform's error domain, code and text; the caller's line speaks instead.
      renderError={() => <View style={[StyleSheet.absoluteFill, { backgroundColor: c.bg }]} />}
    />
  );
}

type SignOutProps = {
  readonly onDone: () => void;
};

/** Loads the logout URL once, unseen; on `onDone` the caller runs `BandcampSession.signOut()` and probes. */
export function SignOutWebView({ onDone }: SignOutProps) {
  const done = useRef(false);
  const finish = (): void => {
    if (done.current) return;
    done.current = true;
    onDone();
  };
  return (
    <View style={styles.hidden} pointerEvents="none">
      <WebView
        source={{ uri: BANDCAMP_LOGOUT_URL }}
        sharedCookiesEnabled
        thirdPartyCookiesEnabled
        onLoadEnd={finish}
        onError={finish}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  hidden: { position: 'absolute', width: 1, height: 1, opacity: 0 },
});

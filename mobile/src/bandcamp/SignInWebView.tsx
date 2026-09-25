/**
 * Bandcamp's own sign-in and sign-out pages in a WebView sharing the app's cookie jar (task 0036, decision 1): iOS
 * copies the WebView's cookies into `NSHTTPCookieStorage` under `sharedCookiesEnabled`, and Android's `CookieManager`
 * is already React Native's jar. Nothing here reads a cookie; the caller probes to learn whether sign-in took.
 */
import { useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView, type WebViewNavigation } from 'react-native-webview';

export const BANDCAMP_LOGIN_URL = 'https://bandcamp.com/login';
export const BANDCAMP_LOGOUT_URL = 'https://bandcamp.com/logout';

const LOGIN_PAGE = /^https:\/\/([a-z0-9-]+\.)*bandcamp\.com\/login\/?([?#]|$)/i;

export function isLoginPage(url: string): boolean {
  return LOGIN_PAGE.test(url);
}

type SignInProps = {
  /** Called each time the page leaves `/login`. */
  readonly onMaybeSignedIn: () => void;
};

export function SignInWebView({ onMaybeSignedIn }: SignInProps) {
  const onLogin = useRef(true);
  const onNavigationStateChange = (state: WebViewNavigation): void => {
    if (state.loading) return;
    if (isLoginPage(state.url)) {
      onLogin.current = true;
    } else if (onLogin.current) {
      onLogin.current = false;
      onMaybeSignedIn();
    }
  };
  return (
    <WebView
      source={{ uri: BANDCAMP_LOGIN_URL }}
      sharedCookiesEnabled
      thirdPartyCookiesEnabled
      onNavigationStateChange={onNavigationStateChange}
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

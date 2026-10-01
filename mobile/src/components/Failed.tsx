/**
 * What shows in place of something that failed (task 0038 decisions 10 and 11): a tab's screen that threw while
 * drawing, under the tab's title or a pushed screen's header with the tab bar still there; the whole app when the root
 * threw; and the store that would not open. The two boundary fallbacks write their Error Report from an effect, since
 * expo-router's `Try` has no `componentDidCatch`; the store's mail is the only report it has, and nothing leaves until
 * it is sent.
 */
import type { ErrorBoundaryProps } from 'expo-router';
// The boundary renders inside its route's node, which no public hook reads; a moved module fails CI's tsc and Metro export.
import { useRouteNode } from 'expo-router/build/Route';
import { openURL } from 'expo-linking';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState, type ReactNode } from 'react';
import { Alert, Platform, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppBarTitle, useAppBarAtRest } from '@/components/AppBar';
import { WideButton } from '@/components/WideButton';
import { copy, FEEDBACK_ADDRESS } from '@/copy';
import type { Screen } from '@/tally/catalogue';
import { feedbackFacts } from '@/tally/appFacts';
import { buildErrorReport } from '@/tally/errorReport';
import { errorReports } from '@/tally/errors';
import { screenForRoute } from '@/tally/tally';
import { useTokens } from '@/theme/tokens';

const ios = Platform.OS === 'ios';
const f = copy.failed;

/** `whole` has no header above it; a tab's view has the tab's title above it, a pushed screen its native header. */
type Place = 'whole' | 'tab' | 'pushed';

function FailedView({ title, body, place, children }: { title: string; body: string; place: Place; children: ReactNode }) {
  const { c, type, dark } = useTokens();
  const insets = useSafeAreaInsets();
  const whole = place === 'whole';
  // iOS insets a tab's scroll view for its header; Android draws the tab's title in the list (AppBar).
  const top = whole ? insets.top + 64 : ios ? 16 : place === 'pushed' ? 24 : 0;
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: c.bg }}
      contentInsetAdjustmentBehavior={whole ? 'never' : 'automatic'}
      contentContainerStyle={{ paddingTop: top, paddingBottom: insets.bottom + 24 }}
    >
      {whole ? <StatusBar style={dark ? 'light' : 'dark'} /> : null}
      {place === 'tab' ? <AppBarTitle subtitle={null} /> : null}
      <View style={{ paddingHorizontal: type.gutter, gap: 12 }}>
        <Text accessibilityRole="header" style={ios ? { fontSize: 22, fontWeight: '700', color: c.ink } : { fontSize: 24, lineHeight: 32, color: c.ink }}>
          {title}
        </Text>
        <Text style={{ fontSize: type.body, lineHeight: 22, color: c.sub }}>{body}</Text>
        <View style={{ gap: 10, paddingTop: 12 }}>{children}</View>
      </View>
    </ScrollView>
  );
}

function useCaughtReport(error: Error, screen?: Screen): void {
  useEffect(() => errorReports.reportCaught(error, screen), [error, screen]);
}

/** The tabs' `screenErrorBoundary`, reporting the screen that threw, which a native tab may have mounted out of view. */
export function ScreenFailed({ error, retry }: ErrorBoundaryProps) {
  const node = useRouteNode();
  useAppBarAtRest();
  useCaughtReport(error, node ? screenForRoute(node.contextKey) : undefined);
  return (
    <FailedView title={f.screenTitle} body={f.screenBody} place={node?.route === 'index' ? 'tab' : 'pushed'}>
      <WideButton label={f.tryAgain} kind="filled" onPress={() => void retry()} />
    </FailedView>
  );
}

/** The root layout's `ErrorBoundary`, outside every provider, so it reads only the tokens. */
export function AppFailed({ error, retry }: ErrorBoundaryProps) {
  useCaughtReport(error);
  return (
    <FailedView title={f.appTitle} body={f.appBody} place="whole">
      <WideButton label={f.tryAgain} kind="filled" onPress={() => void retry()} />
    </FailedView>
  );
}

type StoreFailedProps = {
  readonly error: unknown;
  readonly onRetry: () => void;
  /** Deletes the store file and opens a fresh one; rejects when the file would not go. */
  readonly onStartOver: () => Promise<void>;
};

/**
 * The store that would not open (review REL-4): "Try again" for a passing cause, the mail with the cause scrubbed as an
 * Error Report's would be (task 0038 decision 11 sends nothing by itself), and "Start over" after a confirm for a cause
 * that fails the same way on every open.
 */
export function StoreFailed({ error, onRetry, onStartOver }: StoreFailedProps) {
  const [stuck, setStuck] = useState(false);
  const mail = () => {
    const at = { t: Date.now(), source: 'code', fatal: false, screen: 'other', code: 'store_open_failed' } as const;
    const { name, message } = buildErrorReport(error, at);
    const body = f.reportBody(feedbackFacts(null), { name, message });
    const query = `subject=${encodeURIComponent(f.reportSubject)}&body=${encodeURIComponent(body)}`;
    openURL(`mailto:${FEEDBACK_ADDRESS}?${query}`).catch(() => undefined);
  };
  const startOver = () =>
    Alert.alert(f.startOverTitle, f.startOverBody, [
      { text: f.cancel, style: 'cancel' },
      { text: f.startOverConfirm, style: 'destructive', onPress: () => void onStartOver().catch(() => setStuck(true)) },
    ]);
  return (
    <FailedView title={f.storeTitle} body={stuck ? f.startOverFailed : f.storeBody} place="whole">
      <WideButton label={f.tryAgain} kind="filled" onPress={onRetry} />
      <WideButton label={f.sendReport} kind="tonal" onPress={mail} />
      <WideButton label={f.startOver} kind="plain" onPress={startOver} />
    </FailedView>
  );
}

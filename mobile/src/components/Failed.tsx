/**
 * What shows in place of something that failed (task 0038 decisions 10 and 11): a tab's screen that threw while
 * drawing, under the tab's own title with the tab bar still there; the whole app when the root threw; and the store
 * that would not open. The two boundary fallbacks write their Error Report from an effect, since expo-router's `Try`
 * has no `componentDidCatch`; the store's mail is the only report it has, and nothing leaves until it is sent.
 */
import type { ErrorBoundaryProps } from 'expo-router';
import { openURL } from 'expo-linking';
import { StatusBar } from 'expo-status-bar';
import { useEffect, type ReactNode } from 'react';
import { Platform, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { WideButton } from '@/components/WideButton';
import { copy, FEEDBACK_ADDRESS } from '@/copy';
import { feedbackFacts } from '@/tally/appFacts';
import { errorReports } from '@/tally/errors';
import { useTokens } from '@/theme/tokens';

const ios = Platform.OS === 'ios';
const f = copy.failed;

function FailedView({ title, body, whole, children }: { title: string; body: string; whole: boolean; children: ReactNode }) {
  const { c, type, dark } = useTokens();
  const insets = useSafeAreaInsets();
  // Inside a tab, iOS draws the tab's large title above this and insets the scroll view for it.
  const top = ios && !whole ? 16 : insets.top + (whole ? 64 : 24);
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: c.bg }}
      contentInsetAdjustmentBehavior={whole ? 'never' : 'automatic'}
      contentContainerStyle={{ paddingHorizontal: type.gutter, paddingTop: top, paddingBottom: insets.bottom + 24, gap: 12 }}
    >
      {whole ? <StatusBar style={dark ? 'light' : 'dark'} /> : null}
      <Text accessibilityRole="header" style={ios ? { fontSize: 22, fontWeight: '700', color: c.ink } : { fontSize: 24, lineHeight: 32, color: c.ink }}>
        {title}
      </Text>
      <Text style={{ fontSize: type.body, lineHeight: 22, color: c.sub }}>{body}</Text>
      <View style={{ gap: 10, paddingTop: 12 }}>{children}</View>
    </ScrollView>
  );
}

function useCaughtReport(error: Error): void {
  useEffect(() => errorReports.reportCaught(error), [error]);
}

/** The tabs' `screenErrorBoundary`. */
export function ScreenFailed({ error, retry }: ErrorBoundaryProps) {
  useCaughtReport(error);
  return (
    <FailedView title={f.screenTitle} body={f.screenBody} whole={false}>
      <WideButton label={f.tryAgain} kind="filled" onPress={() => void retry()} />
    </FailedView>
  );
}

/** The root layout's `ErrorBoundary`, outside every provider, so it reads only the tokens. */
export function AppFailed({ error, retry }: ErrorBoundaryProps) {
  useCaughtReport(error);
  return (
    <FailedView title={f.appTitle} body={f.appBody} whole>
      <WideButton label={f.tryAgain} kind="filled" onPress={() => void retry()} />
    </FailedView>
  );
}

export function StoreFailed({ onRetry }: { onRetry: () => void }) {
  const mail = () => {
    const query = `subject=${encodeURIComponent(f.reportSubject)}&body=${encodeURIComponent(f.reportBody(feedbackFacts(null)))}`;
    openURL(`mailto:${FEEDBACK_ADDRESS}?${query}`).catch(() => undefined);
  };
  return (
    <FailedView title={f.storeTitle} body={f.storeBody} whole>
      <WideButton label={f.tryAgain} kind="filled" onPress={onRetry} />
      <WideButton label={f.sendReport} kind="tonal" onPress={mail} />
    </FailedView>
  );
}

/**
 * The in-scroll half of a view's header (DESIGN-UI section 9, the v2 client canvas): under the native large title on
 * iOS, "Updated 12 min ago" as one quiet line; on Android the medium app bar's title with that line as its subtitle
 * (see AppBar). The catch-up leaves the list for the tab bar's accessory or the strip above the mini player (see
 * CatchUp). No line before the first gather.
 */
import { Platform, Text, View } from 'react-native';

import { useGatherStatus } from '@/state/status';
import { useTokens } from '@/theme/tokens';

import { AppBarTitle } from './AppBar';

export function ScreenHeader() {
  const { c, type } = useTokens();
  const { line } = useGatherStatus();
  const text = line?.kind === 'updated' ? line.text : null;
  if (Platform.OS === 'android') return <AppBarTitle subtitle={text} />;
  if (text === null) return <View style={{ height: 8 }} />;
  return <Text style={{ fontSize: type.sub, color: c.sub, paddingHorizontal: type.gutter, paddingBottom: 12 }}>{text}</Text>;
}

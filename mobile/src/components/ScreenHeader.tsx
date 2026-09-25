/**
 * The in-scroll half of a view's header: the "Updated 12 min ago" line under
 * the native title (the v2 client canvas, iOS large title and Android app bar).
 */
import { Text } from 'react-native';

import { copy } from '@/copy';
import { useTokens } from '@/theme/tokens';

export function ScreenHeader() {
  const { c, type } = useTokens();
  return <Text style={{ fontSize: type.sub, color: c.sub, paddingHorizontal: type.gutter, paddingBottom: 12 }}>{copy.updated}</Text>;
}

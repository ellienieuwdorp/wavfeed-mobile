/**
 * The quiet run between weeks with nothing from your pages (DESIGN-UI section 3): a line of faint 13pt text under a
 * hairline in the border colour.
 */
import { View } from 'react-native';

import { useTokens } from '@/theme/tokens';

import { Type } from './Type';

export function GapRow({ text }: { text: string }) {
  const { c, type } = useTokens();
  return (
    <View style={{ borderTopWidth: 1, borderColor: c.border, paddingHorizontal: type.gutter, paddingVertical: 10 }}>
      <Type style={{ fontSize: 13, lineHeight: 18, color: c.faint, fontVariant: ['tabular-nums'] }}>{text}</Type>
    </View>
  );
}

/**
 * The quiet run between weeks with nothing from your pages (DESIGN-UI section 3): one line of faint 13pt text with
 * tabular figures under a solid hairline in the border colour, 10 above and below it and the gutter either side.
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

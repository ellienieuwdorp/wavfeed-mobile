/**
 * The quiet-gap line between weeks with nothing from your pages, faint 13pt
 * under a dashed rule (the v2 client canvas). React Native draws dashed borders
 * only on all four sides, so the rule is a dashed box clipped to its top edge.
 */
import { Text, View } from 'react-native';

import { useTokens } from '@/theme/tokens';

export function GapRow({ text }: { text: string }) {
  const { c, type } = useTokens();
  return (
    <View style={{ marginTop: 12 }}>
      <View style={{ height: 1, overflow: 'hidden' }}>
        <View style={{ height: 3, borderWidth: 1, borderStyle: 'dashed', borderColor: c.border }} />
      </View>
      <Text style={{ fontSize: 13, color: c.faint, paddingHorizontal: type.gutter, paddingVertical: 8 }}>{text}</Text>
    </View>
  );
}

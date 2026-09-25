/**
 * The notice line (DESIGN-UI section 12): raised surface under a rule, pinned
 * above the player, its action in accent, and a dismiss.
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { copy } from '@/copy';
import { useTokens } from '@/theme/tokens';

import { useNotice } from './noticeState';

export function Notice() {
  const { c, type } = useTokens();
  const { notice, dismiss } = useNotice();
  if (!notice) return null;
  return (
    <View
      accessibilityLiveRegion="polite"
      style={{ flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 44, paddingLeft: type.gutter, backgroundColor: c.raised, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border }}
    >
      <Text numberOfLines={2} style={{ flex: 1, fontSize: type.fact, color: c.ink, paddingVertical: 6 }}>{notice.text}</Text>
      {notice.action ? (
        <Pressable accessibilityRole="button" onPress={notice.action.onPress} hitSlop={6} style={{ minHeight: 44, justifyContent: 'center', paddingHorizontal: 4 }}>
          <Text style={{ fontSize: type.fact, fontWeight: '600', color: c.accent }}>{notice.action.label}</Text>
        </Pressable>
      ) : null}
      <Pressable accessibilityRole="button" accessibilityLabel={copy.notice.dismiss} onPress={dismiss} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
        <Ionicons name="close" size={16} color={c.faint} />
      </Pressable>
    </View>
  );
}

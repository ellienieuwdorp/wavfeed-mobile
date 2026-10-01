/**
 * The notice line (DESIGN-UI section 12): pinned above the player with its action in accent and a dismiss. On iOS the
 * raised surface under a rule; on Android Material's snackbar, the platform's one transient line: 4dp corners on the
 * inverse surface at elevation 3, 16dp from the edges, the action in the inverse primary.
 */
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { copy } from '@/copy';
import { dark as darkPalette, light as lightPalette, pressedOpacity, ripple, useTokens } from '@/theme/tokens';

import { Glyph } from './Glyph';
import { useNotice } from './noticeState';

function Snackbar() {
  const { c, dark, type } = useTokens();
  const { notice, dismiss } = useNotice();
  if (!notice) return null;
  const inverse = dark ? lightPalette : darkPalette;
  return (
    <View
      accessibilityLiveRegion="polite"
      style={{ flexDirection: 'row', alignItems: 'center', minHeight: 48, marginHorizontal: 16, paddingLeft: 16, borderRadius: 4, backgroundColor: c.ink, boxShadow: '0 3px 6px rgba(0,0,0,0.18), 0 1px 3px rgba(0,0,0,0.12)' }}
    >
      <Text numberOfLines={2} style={{ flex: 1, fontSize: type.fact, lineHeight: 20, color: c.bg, paddingVertical: 14 }}>{notice.text}</Text>
      {notice.action ? (
        <Pressable
          accessibilityRole="button"
          onPress={notice.action.onPress}
          android_ripple={ripple(inverse.track)}
          hitSlop={{ top: 4, bottom: 4 }}
          style={{ minHeight: 40, justifyContent: 'center', paddingHorizontal: 12, borderRadius: 20, overflow: 'hidden' }}
        >
          <Text style={{ fontSize: 14, fontWeight: '500', color: c.inverseAccent }}>{notice.action.label}</Text>
        </Pressable>
      ) : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={copy.notice.dismiss}
        onPress={dismiss}
        android_ripple={ripple(inverse.track, 20)}
        style={{ width: 48, height: 48, alignItems: 'center', justifyContent: 'center' }}
      >
        <Glyph name="dismiss" size={24} weight="regular" colour={c.bg} />
      </Pressable>
    </View>
  );
}

function Line() {
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
        <Pressable accessibilityRole="button" onPress={notice.action.onPress} hitSlop={6} style={({ pressed }) => ({ minHeight: 44, justifyContent: 'center', paddingHorizontal: 4, opacity: pressedOpacity(pressed) })}>
          <Text style={{ fontSize: type.fact, fontWeight: '600', color: c.accentText }}>{notice.action.label}</Text>
        </Pressable>
      ) : null}
      <Pressable accessibilityRole="button" accessibilityLabel={copy.notice.dismiss} onPress={dismiss} style={({ pressed }) => ({ width: 44, height: 44, alignItems: 'center', justifyContent: 'center', opacity: pressedOpacity(pressed) })}>
        <Glyph name="dismiss" size={14} colour={c.faint} />
      </Pressable>
    </View>
  );
}

export function Notice() {
  return Platform.OS === 'android' ? <Snackbar /> : <Line />;
}

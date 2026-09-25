/**
 * A two- or three-way mode picker drawn with our tokens: on iOS a grey track
 * with a raised selected pill, on Android a Material connected button group
 * whose selected segment goes round and filled (the v2 client canvas).
 */
import { Platform, Pressable, Text, View } from 'react-native';

import { useTokens } from '@/theme/tokens';

const ios = Platform.OS === 'ios';

export type Segment<K extends string> = { key: K; label: string };

export function Segmented<K extends string>({ segments, value, onChange }: { segments: Segment<K>[]; value: K; onChange: (key: K) => void }) {
  const { c } = useTokens();
  const last = segments.length - 1;
  return (
    <View style={ios ? { flexDirection: 'row', backgroundColor: c.track, borderRadius: 9, padding: 2 } : { flexDirection: 'row', gap: 2 }}>
      {segments.map((s, n) => {
        const on = s.key === value;
        const shape = ios
          ? { borderRadius: 7, paddingVertical: 6, backgroundColor: on ? c.surface : 'transparent', boxShadow: on ? '0 2px 6px rgba(0,0,0,0.12)' : undefined }
          : {
              paddingVertical: 10,
              borderWidth: 1,
              borderColor: on ? c.accent : c.border,
              backgroundColor: on ? c.accent : c.raised,
              borderTopLeftRadius: on || n === 0 ? 20 : 6,
              borderBottomLeftRadius: on || n === 0 ? 20 : 6,
              borderTopRightRadius: on || n === last ? 20 : 6,
              borderBottomRightRadius: on || n === last ? 20 : 6,
            };
        return (
          <Pressable key={s.key} onPress={() => onChange(s.key)} accessibilityRole="button" accessibilityState={{ selected: on }} style={[{ flex: 1, alignItems: 'center' }, shape]}>
            <Text style={{ fontSize: ios ? 13 : 14, fontWeight: on && ios ? '600' : '500', color: on && !ios ? c.onAccent : c.ink }}>{s.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

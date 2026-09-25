/**
 * The buyer faces: 20pt discs with two-letter initials, overlapping by 6pt, and
 * "+N" after when more people bought than are drawn (the v2 client canvas).
 */
import { Text, View } from 'react-native';

import { copy } from '@/copy';
import { useTokens } from '@/theme/tokens';

export function AvatarStack({ initials, more, ring }: { initials: string[]; more?: number; ring?: string }) {
  const { c } = useTokens();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
      {initials.map((i, n) => (
        <View
          key={i}
          style={{
            width: 20,
            height: 20,
            borderRadius: 10,
            marginLeft: n === 0 ? 0 : -6,
            borderWidth: 2,
            borderColor: ring ?? c.bg,
            backgroundColor: c.avatarBg,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text style={{ fontSize: 9, fontWeight: '600', color: c.avatarInk }}>{i}</Text>
        </View>
      ))}
      {more ? <Text style={{ marginLeft: 6, fontSize: 11, color: c.faint }}>{copy.more(more)}</Text> : null}
    </View>
  );
}

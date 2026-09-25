/**
 * The buyer faces: 20pt discs, the Fan's Bandcamp image or two-letter initials, overlapping by 6pt, capped at five with
 * a faint "+N" after (DESIGN-UI section 3, the v2 client canvas).
 */
import { Image } from 'expo-image';
import { Text, View } from 'react-native';

import { copy } from '@/copy';
import type { ApiFanRef } from '@/domain/apiTypes';
import { fanAvatarInitials, fanAvatarUrl } from '@/lib/format';
import { useTokens } from '@/theme/tokens';

export const AVATAR_CAP = 5;

export function AvatarStack({ fans, ring }: { fans: readonly ApiFanRef[]; ring?: string }) {
  const { c } = useTokens();
  const shown = fans.slice(0, AVATAR_CAP);
  const more = fans.length - shown.length;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center' }} accessibilityLabel={fans.map((fan) => fan.username).join(', ')}>
      {shown.map((fan, n) => {
        const url = fanAvatarUrl(fan.imageId);
        return (
          <View
            key={fan.fanId}
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
              overflow: 'hidden',
            }}
          >
            {url === null ? (
              <Text style={{ fontSize: 9, fontWeight: '600', color: c.avatarInk }}>{fanAvatarInitials(fan)}</Text>
            ) : (
              <Image source={{ uri: url }} style={{ width: 16, height: 16, borderRadius: 8 }} />
            )}
          </View>
        );
      })}
      {more > 0 ? <Text style={{ marginLeft: 6, fontSize: 11, color: c.faint }}>{copy.more(more)}</Text> : null}
    </View>
  );
}

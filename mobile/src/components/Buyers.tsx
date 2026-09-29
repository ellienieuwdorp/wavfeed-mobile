/**
 * A Bought row's detail line (DESIGN-UI section 3, The Bought view): the faces of who bought it, which open the Bought
 * by sheet, then the label. The Upcoming list adds the release day as the trailing fact (task 0037).
 */
import { Text, View } from 'react-native';

import { SELF_RELEASED, sep } from '@/copy';
import type { ApiFeedItem } from '@/domain/apiTypes';
import { useTokens } from '@/theme/tokens';

import { AvatarStack } from './AvatarStack';

export function Buyers({ release, trailing }: { release: ApiFeedItem; trailing?: string }) {
  const { c, type } = useTokens();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      <AvatarStack fans={release.buyers} opens />
      <Text numberOfLines={1} style={{ flexShrink: 1, fontSize: type.fact, color: c.sub }}>{release.label ?? SELF_RELEASED}</Text>
      {trailing ? <Text numberOfLines={1} style={{ flex: 1, fontSize: type.fact, color: c.faint }}>{sep.trimStart() + trailing}</Text> : <View style={{ flex: 1 }} />}
    </View>
  );
}

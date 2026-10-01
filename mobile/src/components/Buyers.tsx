/**
 * A Bought row's detail line (DESIGN-UI section 3, The Bought view): the faces of who bought it, which open the Bought
 * by sheet, then the label. The Upcoming list adds the release day as the trailing fact (task 0037) and the count of
 * Tracks that play after the label (task 0041, decision 9).
 */
import { Text, View } from 'react-native';

import { actorSentence, SELF_RELEASED, sep, spokenFacts } from '@/copy';
import type { ApiFeedItem } from '@/domain/apiTypes';
import { useTokens } from '@/theme/tokens';

import { AvatarStack } from './AvatarStack';

/** The line as VoiceOver hears a Bought row (VIS-9): who bought it, the label, then `more` (ReleaseRow's `facts`). */
export function buyersFacts(release: ApiFeedItem, ...more: (string | null)[]): string {
  return spokenFacts([actorSentence(release), release.label ?? SELF_RELEASED, ...more]);
}

export function Buyers({ release, fact, trailing }: { release: ApiFeedItem; fact?: string | null; trailing?: string }) {
  const { c, type } = useTokens();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      <AvatarStack fans={release.buyers} opens />
      <Text numberOfLines={1} style={{ flexShrink: 1, fontSize: type.fact, color: c.sub }}>{[release.label ?? SELF_RELEASED, fact].filter(Boolean).join(sep)}</Text>
      {trailing ? <Text numberOfLines={1} style={{ flex: 1, fontSize: type.fact, color: c.faint }}>{sep.trimStart() + trailing}</Text> : <View style={{ flex: 1 }} />}
    </View>
  );
}

/**
 * Feed, the Curated Feed: new Releases from pages you follow, Releases several
 * people you follow bought, and their own words (DESIGN-UI section 5, the v2
 * client canvas), over the canvas sample data.
 */
import { ScrollView, View } from 'react-native';

import { CoverTile, ModuleHead, OverlapPanel, QuoteLine } from '@/components/Curated';
import { useDockClearance } from '@/components/player/Dock';
import { ScreenHeader } from '@/components/ScreenHeader';
import { copy } from '@/copy';
import { COVERS, OVERLAP, QUOTES } from '@/mock/data';
import { useTokens } from '@/theme/tokens';

export default function Feed() {
  const { type } = useTokens();
  const clearance = useDockClearance();
  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ paddingBottom: 32 + clearance }}>
      <ScreenHeader />
      <View style={{ gap: 24, paddingTop: 4 }}>
        <View>
          <ModuleHead title={copy.feed.fromPages} more />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 12, paddingHorizontal: type.gutter }}>
            {COVERS.map((cover) => (
              <CoverTile key={`${cover.t}-${cover.a}`} cover={cover} />
            ))}
          </ScrollView>
        </View>
        <View>
          <ModuleHead title={copy.feed.boughtByFollowed} more />
          <View style={{ gap: 12, paddingHorizontal: type.gutter }}>
            {OVERLAP.map((item) => (
              <OverlapPanel key={`${item.t}-${item.a}`} item={item} />
            ))}
          </View>
        </View>
        <View>
          <ModuleHead title={copy.feed.ownWords} />
          {QUOTES.map((q) => (
            <QuoteLine key={`${q.who}-${q.t}`} quote={q} />
          ))}
        </View>
      </View>
    </ScrollView>
  );
}

/**
 * Feed, the Curated Feed on the store (DESIGN-UI section 5): new Releases from pages you follow as a cover strip,
 * Releases several people you follow bought as one-up cards, and their own words. A module with nothing in it is
 * not drawn; all three empty draw the view's empty state.
 */
import { RefreshControl, ScrollView, View } from 'react-native';

import { CoverTile, ModuleHead, OverlapPanel, QuoteLine } from '@/components/Curated';
import { useAppBar } from '@/components/AppBar';
import { EmptyState } from '@/components/EmptyState';
import { useDockClearance } from '@/components/player/Dock';
import { ScreenHeader } from '@/components/ScreenHeader';
import { copy } from '@/copy';
import { useNow } from '@/lib/useNow';
import { useLiveQuery } from '@/state/appState';
import { useRefresh } from '@/state/refresh';
import { readCurated } from '@/store/queries';
import { useTokens } from '@/theme/tokens';

export default function Feed() {
  const { c, type } = useTokens();
  const clearance = useDockClearance();
  const now = useNow();
  const curated = useLiveQuery((db) => readCurated(db));
  const { refreshing, onRefresh } = useRefresh('feed');
  const appBar = useAppBar();
  const empty =
    curated !== null && curated.newFromPages.length === 0 && curated.boughtByFollowed.length === 0 && curated.inTheirOwnWords.length === 0;

  return (
    <ScrollView
      {...appBar.scroll}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{ paddingBottom: 32 + clearance }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[c.accent]} progressBackgroundColor={c.surface} progressViewOffset={appBar.refreshOffset} />}
    >
      <ScreenHeader />
      {empty ? <EmptyState filling={copy.empty.fillingCurated} nothing={copy.empty.curated} /> : null}
      {curated !== null && !empty ? (
        <View style={{ gap: 24, paddingTop: 4 }}>
          {curated.newFromPages.length > 0 ? (
            <View>
              <ModuleHead title={copy.feed.fromPages} more="/releases" />
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 12, paddingHorizontal: type.gutter }}>
                {curated.newFromPages.map((item) => (
                  <CoverTile key={`${item.itemType}:${item.itemId}`} item={item} now={now} />
                ))}
              </ScrollView>
            </View>
          ) : null}
          {curated.boughtByFollowed.length > 0 ? (
            <View>
              {/* New releases with the people filter on at 1+, the Fan's tags kept. */}
              <ModuleHead title={copy.feed.boughtByFollowed} more="/releases?people=1" />
              <View style={{ gap: 12, paddingHorizontal: type.gutter }}>
                {curated.boughtByFollowed.map((item) => (
                  <OverlapPanel key={`${item.itemType}:${item.itemId}`} item={item} now={now} />
                ))}
              </View>
            </View>
          ) : null}
          {curated.inTheirOwnWords.length > 0 ? (
            <View>
              <ModuleHead title={copy.feed.ownWords} />
              {curated.inTheirOwnWords.map((q) => (
                <QuoteLine key={`${q.fan.fanId}:${q.item.itemType}:${q.item.itemId}`} quote={q} now={now} />
              ))}
            </View>
          ) : null}
        </View>
      ) : null}
    </ScrollView>
  );
}

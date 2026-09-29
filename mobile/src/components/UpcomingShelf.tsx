/**
 * The Upcoming shelf (DESIGN-UI section 3, task 0037): what is not out yet runs sideways, nearest release day first,
 * at one fixed height above the released weeks, which run down. A card is the art as its play control with the day,
 * the title and the artist under it in the same control (PlayArt); Bought's cards add the faces of who bought it, a
 * control of their own. A long press opens the row menu, where the wishlist item is. "View more" pushes the full list.
 */
import type { Href } from 'expo-router';
import { FlatList, Platform, Text, View } from 'react-native';

import { copy } from '@/copy';
import type { ApiFanRef } from '@/domain/apiTypes';
import { ART_SIZE_LARGE } from '@/lib/format';
import { useTokens } from '@/theme/tokens';

import { AvatarStack } from './AvatarStack';
import { ModuleHead } from './Curated';
import { PlayArt } from './PlayArt';
import type { RowRelease } from './playable';
import { ROW_LIST } from './ReleaseRow';
import { RowMenu } from './RowMenu';

const ios = Platform.OS === 'ios';
const CARD = 112;
const GAP = 12;

export type ShelfCard = {
  readonly key: string;
  readonly release: RowRelease;
  /** "Sat 3 Oct", the day it comes out. */
  readonly day: string;
  /** Bought only: the people you follow who bought it. */
  readonly buyers?: readonly ApiFanRef[];
};

function Card({ card }: { card: ShelfCard }) {
  const { c } = useTokens();
  return (
    <View style={{ width: CARD }}>
      <RowMenu release={card.release} width={CARD}>
        {(openMenu) => (
          <PlayArt release={card.release} art={ART_SIZE_LARGE} size={CARD} radius={ios ? 8 : 12} onLongPress={openMenu} style={{ width: CARD }}>
            <View style={{ gap: 2, marginTop: 8 }}>
              <Text numberOfLines={1} style={{ fontSize: 13, fontWeight: '600', color: c.ink }}>{card.day}</Text>
              <Text numberOfLines={1} style={{ fontSize: 15, fontWeight: ios ? '600' : '500', color: c.ink }}>{card.release.title}</Text>
              <Text numberOfLines={1} style={{ fontSize: 13, color: c.sub }}>{card.release.artist}</Text>
            </View>
          </PlayArt>
        )}
      </RowMenu>
      {card.buyers && card.buyers.length > 0 ? (
        <View style={{ flexDirection: 'row', marginTop: 6 }}>
          <AvatarStack fans={card.buyers} opens />
        </View>
      ) : null}
    </View>
  );
}

const keyOf = (card: ShelfCard) => card.key;
const renderCard = ({ item }: { item: ShelfCard }) => <Card card={item} />;
const Gap = () => <View style={{ width: GAP }} />;

export function UpcomingShelf({ cards, more }: { cards: readonly ShelfCard[]; more: Href }) {
  const { type } = useTokens();
  return (
    <View style={{ paddingTop: ios ? 6 : 8, paddingBottom: 4 }}>
      <ModuleHead title={copy.upcoming.title} more={more} />
      <FlatList
        horizontal
        data={cards}
        keyExtractor={keyOf}
        renderItem={renderCard}
        ItemSeparatorComponent={Gap}
        {...ROW_LIST}
        initialNumToRender={4}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: type.gutter }}
      />
    </View>
  );
}

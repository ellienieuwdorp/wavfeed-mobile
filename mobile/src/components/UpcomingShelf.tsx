/**
 * The Upcoming shelf (DESIGN-UI section 3, task 0037): what is not out yet runs sideways, nearest release day first,
 * at one fixed height above the released weeks, which run down. A card follows the row (task 0071, decision 14): the
 * art as its play control, then in the same control the day in small caps with the "1/4" pill at its right end, the
 * title, and the credit line with the faces of who bought it at its right end, two at most. At a larger text size the
 * day and the title each hold two lines, so the lines under them sit level across the shelf (review VIS-1). No heart
 * (task 0037, decision 2); a long press opens the row menu, where the wishlist item is. "View more" pushes the full list.
 */
import type { Href } from 'expo-router';
import { FlatList, Platform, useWindowDimensions, View } from 'react-native';

import { copy, creditText, tracksOutPhrase, tracksOutPill } from '@/copy';
import type { ApiFanRef } from '@/domain/apiTypes';
import { captionTitle } from '@/theme/textSize';
import { rowText, useTokens } from '@/theme/tokens';
import { useMembership } from '@/wishlist/state';

import { ModuleHead } from './Curated';
import { PlayArt } from './PlayArt';
import { creditOf, type RowRelease } from './playable';
import { Faces, Pill, ROW_LIST } from './ReleaseRow';
import { heardParts } from './rowActions';
import { RowMenu } from './RowMenu';
import { Type } from './Type';

const ios = Platform.OS === 'ios';
const CARD = 112;
const GAP = 12;
/** A card's faces: two fit beside the credit line at 112 wide (task 0071, decision 14). */
const CARD_FACES = 2;

export type ShelfCard = {
  readonly key: string;
  readonly release: RowRelease;
  /** "Tue 13 Oct" from onDayPhrase, the day it comes out. */
  readonly day: string;
  /** "out Tue 13 Oct", the same day as the card's label speaks it. */
  readonly out: string;
  /** The Tracks that play and how many it has: the "1/4" pill, "1 of 4 tracks" to a screen reader. */
  readonly tracksOut: number | null;
  readonly numTracks: number | null;
  /** The people you follow who bought it. */
  readonly buyers: readonly ApiFanRef[];
};

function Card({ card }: { card: ShelfCard }) {
  const { c } = useTokens();
  const { fontScale } = useWindowDimensions();
  const title = captionTitle(fontScale, rowText.cardTitle);
  const day = captionTitle(fontScale, rowText.eyebrow);
  const credit = creditOf(card.release);
  const pill = tracksOutPill(card.tracksOut, card.numTracks);
  const membership = useMembership(card.release.itemType, card.release.itemId);
  const heard = heardParts({ title: card.release.title, credit, day: card.out, count: tracksOutPhrase(card.tracksOut, card.numTracks), buyers: card.buyers }, membership);
  return (
    <View style={{ width: CARD }}>
      <RowMenu release={card.release} width={CARD} boughtBy={card.buyers}>
        {(openMenu) => (
          <PlayArt release={card.release} size={CARD} radius={ios ? 8 : 12} onLongPress={openMenu} named={heard.named} spoken={heard.facts} style={{ width: CARD }}>
            <View style={{ gap: 2, marginTop: 10 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, minHeight: 18, marginBottom: 2 }}>
                <Type numberOfLines={day.numberOfLines} allowFontScaling={day.allowFontScaling} style={[rowText.eyebrow, { flexShrink: 1, color: c.faint }, day.style]}>{card.day}</Type>
                {pill ? <Pill text={pill} /> : null}
              </View>
              <Type numberOfLines={title.numberOfLines} allowFontScaling={title.allowFontScaling} style={[rowText.cardTitle, { color: c.ink }, title.style]}>{card.release.title}</Type>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Type numberOfLines={1} style={[rowText.credit, { flexShrink: 1, color: c.sub }]}>{creditText(credit)}</Type>
                <Faces fans={card.buyers} cap={CARD_FACES} />
              </View>
            </View>
          </PlayArt>
        )}
      </RowMenu>
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

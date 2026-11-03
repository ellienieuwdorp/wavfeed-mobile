/**
 * The Upcoming shelf (DESIGN-UI section 3): what is not out yet runs sideways, nearest release day first,
 * at one fixed height above the released weeks, which run down. A card is its art, the play control, with three marks
 * on it: the day, "13 OCT" or "TODAY", top left, the faces
 * of who bought it top right, two at most, a button opening the Bought by sheet, and a partial Release's "1/4" bottom
 * left. Under the art in the same control come the title and the credit line, each the card's full width. At a larger
 * text size the title holds two lines, so the credit lines sit level across the shelf (review VIS-1), while the marks
 * keep their size. No heart; a long press opens the row menu, where the wishlist item is. "View
 * more" pushes the full list.
 */
import type { Href } from 'expo-router';
import { memo } from 'react';
import { FlatList, Platform, useWindowDimensions, View } from 'react-native';

import { copy, creditText, tracksOutPhrase, tracksOutBadge } from '@/copy';
import type { FanRef } from '@/domain/views';
import { captionTitle } from '@/theme/textSize';
import { ON_ART, rowText, useTokens } from '@/theme/tokens';
import { useMembership } from '@/wishlist/state';

import { AvatarStack } from './AvatarStack';
import { FilterEaseCardCell } from './filter/FilterEase';
import { ModuleHead } from './Curated';
import { PlayArt } from './PlayArt';
import { creditOf, type RowRelease } from './playable';
import { ROW_LIST } from './ReleaseRow';
import { heardParts } from './rowActions';
import { RowMenu } from './RowMenu';
import { Type } from './Type';

const ios = Platform.OS === 'ios';
/**
 * The art and the card's width: 112 grown a fifth (the author, 2026-10-15), set to 136, a whole number of pixels at
 * 2x, 3x and Android's 2.625 (420dpi) and on the 4dp grid, while the text and the marks keep their sizes.
 */
const CARD = 136;
const GAP = 12;
/** A card's faces: two at most, then "+N", beside the day on the art's top edge. */
const CARD_FACES = 2;

/**
 * The faces' press area, 44pt tall on iOS and 48dp on Android: down into the art and up and right to its edges, past
 * which the art's bounds stop a touch, and only 2 towards the day, which takes no touch (DESIGN-UI section 11).
 */
const FACES_SLOP = { top: 6, bottom: ios ? 14 : 18, left: 2, right: 6 };

export type ShelfCard = {
  readonly key: string;
  readonly release: RowRelease;
  /** "13 Oct" from onDayPhrase with no year, the day it comes out, drawn in capitals on the art's top-left corner. */
  readonly day: string;
  /** "out Tue 13 Oct", the same day as the card's label speaks it, weekday included. */
  readonly out: string;
  /** The Tracks that play and how many it has: the "1/4" badge on the art's corner, "1 of 4 tracks" to a screen reader. */
  readonly tracksOut: number | null;
  readonly numTracks: number | null;
  /** The people you follow who bought it. */
  readonly buyers: readonly FanRef[];
};

/**
 * A card whose facts are the same as last time skips its render, though the screen builds its card objects afresh on
 * every change (the author's request of 2026-10-14).
 */
const Card = memo(function Card({ card }: { card: ShelfCard }) {
  const { c } = useTokens();
  const { fontScale } = useWindowDimensions();
  const title = captionTitle(fontScale, rowText.cardTitle);
  const credit = creditOf(card.release);
  const badge = tracksOutBadge(card.tracksOut, card.numTracks);
  const membership = useMembership(card.release.itemType, card.release.itemId);
  const heard = heardParts({ title: card.release.title, credit, day: card.out, count: tracksOutPhrase(card.tracksOut, card.numTracks), buyers: card.buyers }, membership);
  return (
    <View style={{ width: CARD }}>
      <RowMenu release={card.release} boughtBy={card.buyers}>
        {(openMenu) => (
          <PlayArt
            release={card.release}
            size={CARD}
            radius={ios ? 8 : 12}
            onLongPress={openMenu}
            named={heard.named}
            spoken={heard.facts}
            badge={badge}
            day={card.day}
            faces={card.buyers.length === 0 ? null : <AvatarStack fans={card.buyers} cap={CARD_FACES} size={ON_ART.face} opens onArt hitSlop={FACES_SLOP} />}
            style={{ width: CARD }}
          >
            <View style={{ gap: 2, marginTop: 10 }}>
              <Type numberOfLines={title.numberOfLines} allowFontScaling={title.allowFontScaling} style={[rowText.cardTitle, { color: c.ink }, title.style]}>{card.release.title}</Type>
              <Type numberOfLines={1} style={[rowText.credit, { color: c.sub }]}>{creditText(credit)}</Type>
            </View>
          </PlayArt>
        )}
      </RowMenu>
    </View>
  );
}, (a, b) => sameCard(a.card, b.card));

function sameCard(a: ShelfCard, b: ShelfCard): boolean {
  return a.release === b.release && a.day === b.day && a.out === b.out && a.tracksOut === b.tracksOut && a.numTracks === b.numTracks && a.buyers === b.buyers;
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
        CellRendererComponent={FilterEaseCardCell}
        {...ROW_LIST}
        initialNumToRender={4}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: type.gutter }}
      />
    </View>
  );
}

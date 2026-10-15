/**
 * The Upcoming shelf (DESIGN-UI section 3, task 0037): what is not out yet runs sideways, nearest release day first,
 * at one fixed height above the released weeks, which run down. A card follows the row (task 0071, decision 14 as
 * amended by the author 2026-10-14): the art as its play control with a partial Release's "1/4" on its corner, then in
 * the same control the day in small caps, "13 Oct", with the faces of who bought it at its right end, two at most, the
 * title, and the credit line the card's full width. The day line is the card's top right as the title line is a row's,
 * and the shortest line on the card, so the faces take room from neither the title nor the credit. At a larger text
 * size the day and the title each hold two lines, so the lines under them sit level across the shelf (review VIS-1).
 * No heart (task 0037, decision 2); a long press opens the row menu, where the wishlist item is. "View more" pushes the
 * full list.
 */
import type { Href } from 'expo-router';
import { memo } from 'react';
import { FlatList, Platform, useWindowDimensions, View } from 'react-native';

import { copy, creditText, tracksOutPhrase, tracksOutBadge } from '@/copy';
import type { ApiFanRef } from '@/domain/apiTypes';
import { captionTitle } from '@/theme/textSize';
import { rowText, useTokens } from '@/theme/tokens';
import { useMembership } from '@/wishlist/state';

import { AvatarStack } from './AvatarStack';
import { ModuleHead } from './Curated';
import { PlayArt } from './PlayArt';
import { creditOf, type RowRelease } from './playable';
import { ROW_LIST } from './ReleaseRow';
import { heardParts } from './rowActions';
import { RowMenu } from './RowMenu';
import { Type } from './Type';

const ios = Platform.OS === 'ios';
const CARD = 112;
const GAP = 12;
/** A card's faces: two fit beside the day line at 112 wide (task 0071, decision 14). */
const CARD_FACES = 2;
/** The faces' discs, centred on the day's first line, so a day held at two lines keeps them beside its words. */
const FACE = 20;

/**
 * 8pt above the faces and 2pt below: they end the day line, so the press area reaches over the gap under the art and
 * never down into the title (finding VIS-13, DESIGN-UI section 11).
 * ceiling: that makes the target 30pt tall, short of 44pt or 48dp; a stack the card's full width is the upgrade.
 */
const FACES_SLOP = { top: 8, bottom: 2, left: 8, right: 8 };

/** The faces at the day line's right end, 2pt in from it as the canvas draws them, `top` setting them down from its top. */
function Faces({ fans, top }: { fans: readonly ApiFanRef[]; top: number }) {
  if (fans.length === 0) return null;
  return (
    <View style={{ marginLeft: 'auto', marginRight: 2, marginTop: top, flexShrink: 0 }}>
      <AvatarStack fans={fans} cap={CARD_FACES} size={FACE} opens hitSlop={FACES_SLOP} />
    </View>
  );
}

export type ShelfCard = {
  readonly key: string;
  readonly release: RowRelease;
  /** "13 Oct" from onDayPhrase, the day it comes out. */
  readonly day: string;
  /** "out Tue 13 Oct", the same day as the card's label speaks it, weekday included. */
  readonly out: string;
  /** The Tracks that play and how many it has: the "1/4" badge on the art's corner, "1 of 4 tracks" to a screen reader. */
  readonly tracksOut: number | null;
  readonly numTracks: number | null;
  /** The people you follow who bought it. */
  readonly buyers: readonly ApiFanRef[];
};

/**
 * A card whose facts are the same as last time skips its render, though the screen builds its card objects afresh on
 * every change (the author's request of 2026-10-14).
 */
const Card = memo(function Card({ card }: { card: ShelfCard }) {
  const { c } = useTokens();
  const { fontScale } = useWindowDimensions();
  const title = captionTitle(fontScale, rowText.cardTitle);
  const day = captionTitle(fontScale, rowText.eyebrow);
  const lift = ((day.style?.lineHeight ?? rowText.eyebrow.lineHeight) - FACE) / 2;
  const credit = creditOf(card.release);
  const badge = tracksOutBadge(card.tracksOut, card.numTracks);
  const membership = useMembership(card.release.itemType, card.release.itemId);
  const heard = heardParts({ title: card.release.title, credit, day: card.out, count: tracksOutPhrase(card.tracksOut, card.numTracks), buyers: card.buyers }, membership);
  return (
    <View style={{ width: CARD }}>
      <RowMenu release={card.release} width={CARD} boughtBy={card.buyers}>
        {(openMenu) => (
          <PlayArt release={card.release} size={CARD} radius={ios ? 8 : 12} onLongPress={openMenu} named={heard.named} spoken={heard.facts} badge={badge} style={{ width: CARD }}>
            <View style={{ gap: 2, marginTop: 10 }}>
              <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginBottom: 1 }}>
                <Type numberOfLines={day.numberOfLines} allowFontScaling={day.allowFontScaling} style={[rowText.eyebrow, { flexShrink: 1, marginVertical: Math.max(0, -lift), color: c.faint }, day.style]}>{card.day}</Type>
                <Faces fans={card.buyers} top={Math.max(0, lift)} />
              </View>
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
        {...ROW_LIST}
        initialNumToRender={4}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: type.gutter }}
      />
    </View>
  );
}

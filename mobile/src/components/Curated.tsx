/**
 * The Curated Feed's three modules (DESIGN-UI section 5, the v2 client canvas): the cover strip of new Releases from
 * pages you follow, the one-up Bought-by cards with their heart, and the review quotes, each under a module head whose
 * "View more" switches to the tab holding the full view. The art plays everywhere (PlayArt, DESIGN-UI section 11): a
 * cover's captions share its control, a card's and a quote's art is the only press that plays. At a larger text size a
 * cover's title holds two lines, so the captions sit level along the strip (review VIS-1). A long press on a
 * cover, a card or a quote opens the row menu, and a card's faces open the Bought by sheet. Android takes the canvas's
 * Expressive shapes: 12dp covers, 16dp cards.
 */
import { router, type Href } from 'expo-router';
import { Platform, Pressable, useWindowDimensions, View } from 'react-native';

import { boughtOnPhrase, boughtThisPhrase, buyersPhrase, copy, fanName, releasedOnPhrase, sep, tracksOutPhrase, tracksOutBadge } from '@/copy';
import type { CuratedQuote, FeedItem } from '@/domain/views';
import { notOutYet } from '@/domain/newReleases';
import { captionTitle } from '@/theme/textSize';
import { pressedOpacity, ripple, useTokens } from '@/theme/tokens';
import { releaseHeart } from '@/wishlist/target';

import { AvatarStack } from './AvatarStack';
import { Heart } from './Heart';
import { PlayArt } from './PlayArt';
import { playableItemType } from './playable';
import { RowMenu, RowSurface } from './RowMenu';
import { Type } from './Type';

const ios = Platform.OS === 'ios';
const COVER = ios ? 132 : 136;

/** The title and "View more" share a row; when the larger text sizes leave no room, "View more" wraps under the title (review VIS-1). */
export function ModuleHead({ title, more }: { title: string; more?: Href }) {
  const { c, type } = useTokens();
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', justifyContent: 'space-between', columnGap: 12, rowGap: 4, paddingHorizontal: type.gutter, marginBottom: 12 }}>
      <Type scale="head" accessibilityRole="header" style={{ flexShrink: 1, fontSize: type.moduleHead, fontWeight: ios ? '700' : '600', color: c.ink }}>{title}</Type>
      {more ? (
        <Pressable accessibilityRole="link" hitSlop={{ top: 14, bottom: 14, left: 12, right: 12 }} android_ripple={ripple(c.track, 40)} onPress={() => router.navigate(more)} style={({ pressed }) => ({ opacity: pressedOpacity(pressed) })}>
          <Type style={{ fontSize: ios ? 15 : 14, fontWeight: '500', color: c.accentText }}>{copy.feed.viewMore}</Type>
        </Pressable>
      ) : null}
    </View>
  );
}

/**
 * A Release not out yet with some Tracks out carries its "1/4" on the art, and its label says "1 of 4 tracks"; a released one's count says nothing new.
 */
function partial(item: FeedItem, now: Date): { badge: string | null; spoken: string | undefined } {
  if (!notOutYet(item, now)) return { badge: null, spoken: undefined };
  return { badge: tracksOutBadge(item.numStreamableTracks, item.numTracks), spoken: tracksOutPhrase(item.numStreamableTracks, item.numTracks) ?? undefined };
}

export function CoverTile({ item, now }: { item: FeedItem; now: Date }) {
  const { c } = useTokens();
  const { fontScale } = useWindowDimensions();
  const title = captionTitle(fontScale);
  return (
    <RowMenu release={item}>
      {(openMenu) => (
        <PlayArt release={item} size={COVER} radius={ios ? 6 : 12} onLongPress={openMenu} {...partial(item, now)} style={{ width: COVER }}>
          <View style={{ gap: 2, marginTop: 8 }}>
            <Type numberOfLines={title.numberOfLines} allowFontScaling={title.allowFontScaling} style={[{ fontSize: 15, fontWeight: ios ? '600' : '500', color: c.ink }, title.style]}>{item.title}</Type>
            <Type numberOfLines={1} style={{ fontSize: 13, color: c.sub }}>{item.pageName}</Type>
            <Type numberOfLines={1} style={{ fontSize: 13, color: c.sub }}>{releasedOnPhrase(item.releaseDate, item.latestStoryDate, now)}</Type>
          </View>
        </PlayArt>
      )}
    </RowMenu>
  );
}

/** The card's heart: the Release's key, its title for the label, and the surface it sits on. */
function heartFor(release: FeedItem) {
  return { item: releaseHeart({ itemType: playableItemType(release.itemType), itemId: release.itemId, title: release.title }), surface: 'row' as const };
}

/** The heart's drawn icon sits on the card's padding line; its 44pt or 48dp target reaches into the padding (DESIGN-UI section 12). */
const HEART_REACH = ios ? -12 : -13;

export function OverlapPanel({ item, now }: { item: FeedItem; now: Date }) {
  const { c } = useTokens();
  return (
    <RowMenu release={item}>
      {(openMenu) => (
        <RowSurface open={openMenu} style={{ backgroundColor: c.surface, borderRadius: ios ? 14 : 16, padding: 14, gap: 10 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <PlayArt release={item} size={88} radius={ios ? 8 : 12} onLongPress={openMenu} {...partial(item, now)} />
            <View style={{ flex: 1, gap: 4 }}>
              <Type numberOfLines={1} style={{ fontSize: 16, fontWeight: ios ? '600' : '500', color: c.ink }}>{item.title}</Type>
              <Type numberOfLines={1} style={{ fontSize: 13, color: c.sub }}>{[item.pageName, item.label].filter(Boolean).join(sep)}</Type>
              <View style={{ flexDirection: 'row' }}>
                <AvatarStack fans={item.buyers} ring={c.surface} opens />
              </View>
            </View>
            <View style={{ marginRight: HEART_REACH }}>
              <Heart {...heartFor(item)} />
            </View>
          </View>
          <Type style={{ fontSize: 14, color: c.sub }}>
            <Type style={{ fontWeight: '700', color: c.ink }}>{buyersPhrase(item.buyers)}</Type>
            {boughtThisPhrase(item.latestStoryDate, now)}
          </Type>
        </RowSurface>
      )}
    </RowMenu>
  );
}

export function QuoteLine({ quote, now }: { quote: CuratedQuote; now: Date }) {
  const { c, type } = useTokens();
  return (
    <RowMenu release={quote.item}>
      {(openMenu) => (
        <RowSurface open={openMenu} style={{ flexDirection: 'row', gap: 12, paddingHorizontal: type.gutter, paddingVertical: 12 }}>
          <PlayArt release={quote.item} size={56} radius={ios ? 4 : 8} onLongPress={openMenu} />
          <View style={{ flex: 1, gap: 4 }}>
            <Type style={{ fontSize: 13, color: c.sub }}>
              <Type style={{ fontWeight: '600', color: c.ink }}>{fanName(quote.fan)}</Type>
              {copy.feed.quoteOn + [quote.item.title, quote.item.pageName, boughtOnPhrase(quote.date, now)].join(sep)}
            </Type>
            <Type style={{ fontSize: 15, fontStyle: 'italic', color: c.ink }}>{copy.feed.quoted(quote.text)}</Type>
          </View>
        </RowSurface>
      )}
    </RowMenu>
  );
}

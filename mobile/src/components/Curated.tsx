/**
 * The Curated Feed's three modules (DESIGN-UI section 5, the v2 client canvas): the cover strip of new Releases from
 * pages you follow, the one-up Bought-by cards with their heart, and the review quotes, each under a module head whose
 * "View more" switches to the tab holding the full view. The art plays everywhere (PlayArt, DESIGN-UI section 11): a
 * cover's captions share its control, a card's and a quote's art is the only press that plays. A long press on a
 * cover, a card or a quote opens the row menu, and a card's faces open the Bought by sheet. Android takes the canvas's
 * Expressive shapes: 12dp covers, 16dp cards.
 */
import { router, type Href } from 'expo-router';
import { Platform, Pressable, Text, useWindowDimensions, View } from 'react-native';

import { boughtOnPhrase, boughtThisPhrase, buyersPhrase, copy, fanName, releasedOnPhrase, sep } from '@/copy';
import type { ApiCuratedQuote, ApiFeedItem } from '@/domain/apiTypes';
import { pressedOpacity, ripple, useTokens } from '@/theme/tokens';

import { AvatarStack } from './AvatarStack';
import { Heart } from './Heart';
import { PlayArt } from './PlayArt';
import { heartFor } from './ReleaseRow';
import { RowMenu, RowSurface } from './RowMenu';

const ios = Platform.OS === 'ios';
const COVER = ios ? 132 : 136;

export function ModuleHead({ title, more }: { title: string; more?: Href }) {
  const { c, type } = useTokens();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', paddingHorizontal: type.gutter, marginBottom: 12 }}>
      <Text accessibilityRole="header" style={{ fontSize: type.moduleHead, fontWeight: ios ? '700' : '600', color: c.ink }}>{title}</Text>
      {more ? (
        <Pressable accessibilityRole="link" hitSlop={{ top: 14, bottom: 14, left: 12, right: 12 }} android_ripple={ripple(c.track, 40)} onPress={() => router.navigate(more)} style={({ pressed }) => ({ opacity: pressedOpacity(pressed) })}>
          <Text style={{ fontSize: ios ? 15 : 14, fontWeight: '500', color: c.accent }}>{copy.feed.viewMore}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export function CoverTile({ item, now }: { item: ApiFeedItem; now: Date }) {
  const { c } = useTokens();
  return (
    <RowMenu release={item} width={COVER}>
      {(openMenu) => (
        <PlayArt release={item} size={COVER} radius={ios ? 6 : 12} onLongPress={openMenu} style={{ width: COVER }}>
          <View style={{ gap: 2, marginTop: 8 }}>
            <Text numberOfLines={1} style={{ fontSize: 15, fontWeight: ios ? '600' : '500', color: c.ink }}>{item.title}</Text>
            <Text numberOfLines={1} style={{ fontSize: 13, color: c.sub }}>{item.artist}</Text>
            <Text numberOfLines={1} style={{ fontSize: 13, color: c.sub }}>{releasedOnPhrase(item.releaseDate, item.latestStoryDate, now)}</Text>
          </View>
        </PlayArt>
      )}
    </RowMenu>
  );
}

/** The heart's drawn icon sits on the card's padding line; its 44pt or 48dp target reaches into the padding (DESIGN-UI section 12). */
const HEART_REACH = ios ? -12 : -13;

export function OverlapPanel({ item, now }: { item: ApiFeedItem; now: Date }) {
  const { c, type } = useTokens();
  const { width } = useWindowDimensions();
  return (
    <RowMenu release={item} width={width - type.gutter * 2}>
      {(openMenu) => (
        <RowSurface open={openMenu} style={{ backgroundColor: c.surface, borderRadius: ios ? 14 : 16, padding: 14, gap: 10 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <PlayArt release={item} size={88} radius={ios ? 8 : 12} onLongPress={openMenu} />
            <View style={{ flex: 1, gap: 4 }}>
              <Text numberOfLines={1} style={{ fontSize: 16, fontWeight: ios ? '600' : '500', color: c.ink }}>{item.title}</Text>
              <Text numberOfLines={1} style={{ fontSize: 13, color: c.sub }}>{[item.artist, item.label].filter(Boolean).join(sep)}</Text>
              <View style={{ flexDirection: 'row' }}>
                <AvatarStack fans={item.buyers} ring={c.surface} opens />
              </View>
            </View>
            <View style={{ marginRight: HEART_REACH }}>
              <Heart {...heartFor(item)} />
            </View>
          </View>
          <Text style={{ fontSize: 14, color: c.sub }}>
            <Text style={{ fontWeight: '700', color: c.ink }}>{buyersPhrase(item.buyers)}</Text>
            {boughtThisPhrase(item.latestStoryDate, now)}
          </Text>
        </RowSurface>
      )}
    </RowMenu>
  );
}

export function QuoteLine({ quote, now }: { quote: ApiCuratedQuote; now: Date }) {
  const { c, type } = useTokens();
  const { width } = useWindowDimensions();
  return (
    <RowMenu release={quote.item} width={width}>
      {(openMenu) => (
        <RowSurface open={openMenu} style={{ flexDirection: 'row', gap: 12, paddingHorizontal: type.gutter, paddingVertical: 12 }}>
          <PlayArt release={quote.item} size={56} radius={ios ? 4 : 8} onLongPress={openMenu} />
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={{ fontSize: 13, color: c.sub }}>
              <Text style={{ fontWeight: '600', color: c.ink }}>{fanName(quote.fan)}</Text>
              {copy.feed.quoteOn + [quote.item.title, quote.item.artist, boughtOnPhrase(quote.date, now)].join(sep)}
            </Text>
            <Text style={{ fontSize: 15, fontStyle: 'italic', color: c.ink }}>{copy.feed.quoted(quote.text)}</Text>
          </View>
        </RowSurface>
      )}
    </RowMenu>
  );
}

/**
 * The Curated Feed's three modules (DESIGN-UI section 5, the v2 client canvas): the cover strip of new Releases from
 * pages you follow, the one-up Bought-by cards with their play disc and heart, and the review quotes, each under a
 * module head whose "View more" switches to the tab holding the full view. A long press on a cover, a card or a quote
 * opens the row menu, and a card's faces open the Bought by sheet. Android takes the canvas's Expressive shapes:
 * 12dp covers, 16dp cards, the rounded-square play button, and the ripple on everything that plays.
 */
import { router, type Href } from 'expo-router';
import { Platform, Pressable, Text, useWindowDimensions, View } from 'react-native';

import { boughtOnPhrase, boughtThisPhrase, buyersPhrase, copy, fanName, releasedOnPhrase, sep } from '@/copy';
import type { ApiCuratedQuote, ApiFeedItem } from '@/domain/apiTypes';
import { ART_SIZE_LARGE, ART_SIZE_ROW, hueFor, releaseArtUrl } from '@/lib/format';
import { pressedOpacity, ripple, useTokens } from '@/theme/tokens';

import { Artwork } from './Artwork';
import { AvatarStack } from './AvatarStack';
import { Glyph } from './Glyph';
import { Heart } from './Heart';
import { usePlay } from './playable';
import { heartFor } from './ReleaseRow';
import { RowMenu } from './RowMenu';

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
  const play = usePlay();
  return (
    <RowMenu release={item} width={COVER}>
      {(openMenu) => (
        <Pressable
          onPress={() => play(item)}
          onLongPress={openMenu}
          accessibilityRole="button"
          accessibilityLabel={copy.play(item.title)}
          android_ripple={ripple(c.track)}
          style={({ pressed }) => ({ width: COVER, gap: 2, opacity: pressedOpacity(pressed) })}
        >
          <View style={{ marginBottom: 6 }}>
            <Artwork hue={hueFor(item.itemId)} url={releaseArtUrl(item.artId, ART_SIZE_LARGE)} size={COVER} radius={ios ? 6 : 12} />
          </View>
          <Text numberOfLines={1} style={{ fontSize: 15, fontWeight: ios ? '600' : '500', color: c.ink }}>{item.title}</Text>
          <Text numberOfLines={1} style={{ fontSize: 13, color: c.sub }}>{item.artist}</Text>
          <Text numberOfLines={1} style={{ fontSize: 13, color: c.sub }}>{releasedOnPhrase(item.releaseDate, item.latestStoryDate, now)}</Text>
        </Pressable>
      )}
    </RowMenu>
  );
}

function PlayDisc({ title, onPress }: { title: string; onPress: () => void }) {
  const { c } = useTokens();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={copy.play(title)}
      hitSlop={4}
      android_ripple={ripple(c.onAccent)}
      style={({ pressed }) => ({ width: ios ? 40 : 44, height: ios ? 40 : 44, borderRadius: ios ? 20 : 14, overflow: ios ? undefined : 'hidden', backgroundColor: c.accent, alignItems: 'center', justifyContent: 'center', opacity: pressedOpacity(pressed) })}
    >
      <Glyph name="play" size={ios ? 16 : 18} weight="regular" colour={c.onAccent} />
    </Pressable>
  );
}

export function OverlapPanel({ item, now }: { item: ApiFeedItem; now: Date }) {
  const { c, type } = useTokens();
  const play = usePlay();
  const { width } = useWindowDimensions();
  return (
    <RowMenu release={item} width={width - type.gutter * 2}>
      {(openMenu) => (
        <Pressable onLongPress={openMenu} style={{ backgroundColor: c.surface, borderRadius: ios ? 14 : 16, padding: 14, gap: 10 }}>
          <View style={{ flexDirection: 'row', gap: 12 }}>
            <Artwork hue={hueFor(item.itemId)} url={releaseArtUrl(item.artId, ART_SIZE_LARGE)} size={88} radius={ios ? 8 : 12} />
            <View style={{ flex: 1, gap: 4 }}>
              <Text numberOfLines={1} style={{ fontSize: 16, fontWeight: ios ? '600' : '500', color: c.ink }}>{item.title}</Text>
              <Text numberOfLines={1} style={{ fontSize: 13, color: c.sub }}>{[item.artist, item.label].filter(Boolean).join(sep)}</Text>
              <View style={{ flexDirection: 'row' }}>
                <AvatarStack fans={item.buyers} ring={c.surface} opens />
              </View>
            </View>
            <View style={{ alignItems: 'center', gap: 2 }}>
              <PlayDisc title={item.title} onPress={() => play(item)} />
              <Heart {...heartFor(item)} />
            </View>
          </View>
          <Text style={{ fontSize: 14, color: c.sub }}>
            <Text style={{ fontWeight: '700', color: c.ink }}>{buyersPhrase(item.buyers)}</Text>
            {boughtThisPhrase(item.latestStoryDate, now)}
          </Text>
        </Pressable>
      )}
    </RowMenu>
  );
}

export function QuoteLine({ quote, now }: { quote: ApiCuratedQuote; now: Date }) {
  const { c, type } = useTokens();
  const play = usePlay();
  const { width } = useWindowDimensions();
  return (
    <RowMenu release={quote.item} width={width}>
      {(openMenu) => (
        <Pressable onLongPress={openMenu} style={{ flexDirection: 'row', gap: 12, paddingHorizontal: type.gutter, paddingVertical: 12 }}>
          <Pressable onPress={() => play(quote.item)} onLongPress={openMenu} accessibilityRole="button" accessibilityLabel={copy.play(quote.item.title)} android_ripple={ripple(c.track)} style={({ pressed }) => ({ opacity: pressedOpacity(pressed) })}>
            <Artwork hue={hueFor(quote.item.itemId)} url={releaseArtUrl(quote.item.artId, ART_SIZE_ROW)} size={56} radius={ios ? 4 : 8} />
          </Pressable>
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={{ fontSize: 13, color: c.sub }}>
              <Text style={{ fontWeight: '600', color: c.ink }}>{fanName(quote.fan)}</Text>
              {copy.feed.quoteOn + [quote.item.title, quote.item.artist, boughtOnPhrase(quote.date, now)].join(sep)}
            </Text>
            <Text style={{ fontSize: 15, fontStyle: 'italic', color: c.ink }}>{copy.feed.quoted(quote.text)}</Text>
          </View>
        </Pressable>
      )}
    </RowMenu>
  );
}

/**
 * The Curated Feed's three modules (DESIGN-UI section 5, the v2 client canvas): the cover strip of new Releases from
 * pages you follow, the one-up Bought-by cards with their play disc and heart, and the review quotes, each under a
 * module head whose "View more" opens the full view.
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { router, type Href } from 'expo-router';
import { Pressable, Text, View } from 'react-native';

import { boughtOnPhrase, boughtThisPhrase, buyersPhrase, copy, fanName, releasedOnPhrase, sep } from '@/copy';
import type { ApiCuratedQuote, ApiFeedItem } from '@/domain/apiTypes';
import { ART_SIZE_LARGE, ART_SIZE_ROW, hueFor, releaseArtUrl } from '@/lib/format';
import { useTokens } from '@/theme/tokens';

import { Artwork } from './Artwork';
import { AvatarStack } from './AvatarStack';
import { Heart } from './Heart';
import { usePlay } from './playable';
import { heartFor } from './ReleaseRow';

export function ModuleHead({ title, more }: { title: string; more?: Href }) {
  const { c, type } = useTokens();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', paddingHorizontal: type.gutter, marginBottom: 12 }}>
      <Text style={{ fontSize: type.moduleHead, fontWeight: '700', color: c.ink }}>{title}</Text>
      {more ? (
        <Pressable accessibilityRole="link" hitSlop={12} onPress={() => router.navigate(more)}>
          <Text style={{ fontSize: 15, fontWeight: '500', color: c.accent }}>{copy.feed.viewMore}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export function CoverTile({ item, now }: { item: ApiFeedItem; now: Date }) {
  const { c } = useTokens();
  const play = usePlay();
  return (
    <Pressable onPress={() => play(item)} accessibilityRole="button" accessibilityLabel={copy.play(item.title)} style={{ width: 132, gap: 2 }}>
      <View style={{ marginBottom: 6 }}>
        <Artwork hue={hueFor(item.itemId)} url={releaseArtUrl(item.artId, ART_SIZE_LARGE)} size={132} />
      </View>
      <Text numberOfLines={1} style={{ fontSize: 15, fontWeight: '600', color: c.ink }}>{item.title}</Text>
      <Text numberOfLines={1} style={{ fontSize: 13, color: c.sub }}>{item.artist}</Text>
      <Text numberOfLines={1} style={{ fontSize: 13, color: c.sub }}>{releasedOnPhrase(item.releaseDate, item.latestStoryDate, now)}</Text>
    </Pressable>
  );
}

function PlayDisc({ title, onPress }: { title: string; onPress: () => void }) {
  const { c } = useTokens();
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={copy.play(title)} hitSlop={4} style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: c.accent, alignItems: 'center', justifyContent: 'center' }}>
      <Ionicons name="play" size={16} color={c.onAccent} style={{ marginLeft: 2 }} />
    </Pressable>
  );
}

export function OverlapPanel({ item, now }: { item: ApiFeedItem; now: Date }) {
  const { c } = useTokens();
  const play = usePlay();
  return (
    <View style={{ backgroundColor: c.surface, borderRadius: 14, padding: 14, gap: 10 }}>
      <View style={{ flexDirection: 'row', gap: 12 }}>
        <Artwork hue={hueFor(item.itemId)} url={releaseArtUrl(item.artId, ART_SIZE_LARGE)} size={88} radius={8} />
        <View style={{ flex: 1, gap: 4 }}>
          <Text numberOfLines={1} style={{ fontSize: 16, fontWeight: '600', color: c.ink }}>{item.title}</Text>
          <Text numberOfLines={1} style={{ fontSize: 13, color: c.sub }}>{[item.artist, item.label].filter(Boolean).join(sep)}</Text>
          <AvatarStack fans={item.buyers} ring={c.surface} />
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
    </View>
  );
}

export function QuoteLine({ quote, now }: { quote: ApiCuratedQuote; now: Date }) {
  const { c, type } = useTokens();
  const play = usePlay();
  return (
    <View style={{ flexDirection: 'row', gap: 12, paddingHorizontal: type.gutter, paddingVertical: 12 }}>
      <Pressable onPress={() => play(quote.item)} accessibilityRole="button" accessibilityLabel={copy.play(quote.item.title)}>
        <Artwork hue={hueFor(quote.item.itemId)} url={releaseArtUrl(quote.item.artId, ART_SIZE_ROW)} size={56} radius={4} />
      </Pressable>
      <View style={{ flex: 1, gap: 4 }}>
        <Text style={{ fontSize: 13, color: c.sub }}>
          <Text style={{ fontWeight: '600', color: c.ink }}>{fanName(quote.fan)}</Text>
          {copy.feed.quoteOn + [quote.item.title, quote.item.artist, boughtOnPhrase(quote.date, now)].join(sep)}
        </Text>
        <Text style={{ fontSize: 15, fontStyle: 'italic', color: c.ink }}>{copy.feed.quoted(quote.text)}</Text>
      </View>
    </View>
  );
}

/**
 * The Curated Feed's three modules (DESIGN-UI section 5, the v2 client canvas):
 * the cover strip of new Releases from pages you follow, the one-up Network
 * Overlap panels, and the review quotes, each under a module head.
 */
import { Pressable, Text, View } from 'react-native';

import { copy, sep } from '@/copy';
import type { Cover, Overlap, Quote } from '@/mock/data';
import { useTokens } from '@/theme/tokens';

import { Artwork } from './Artwork';
import { AvatarStack } from './AvatarStack';

export function ModuleHead({ title, more = false }: { title: string; more?: boolean }) {
  const { c, type } = useTokens();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', paddingHorizontal: type.gutter, marginBottom: 12 }}>
      <Text style={{ fontSize: type.moduleHead, fontWeight: '700', color: c.ink }}>{title}</Text>
      {more ? (
        <Pressable accessibilityRole="button" hitSlop={12}>
          <Text style={{ fontSize: 15, fontWeight: '500', color: c.accent }}>{copy.feed.viewMore}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export function CoverTile({ cover }: { cover: Cover }) {
  const { c } = useTokens();
  return (
    <View style={{ width: 132, gap: 2 }}>
      <View style={{ marginBottom: 6 }}>
        <Artwork hue={cover.hue} size={132} />
      </View>
      <Text numberOfLines={1} style={{ fontSize: 15, fontWeight: '600', color: c.ink }}>{cover.t}</Text>
      <Text numberOfLines={1} style={{ fontSize: 13, color: c.sub }}>{cover.a}</Text>
      <Text numberOfLines={1} style={{ fontSize: 13, color: c.sub }}>{cover.f}</Text>
    </View>
  );
}

export function OverlapPanel({ item }: { item: Overlap }) {
  const { c } = useTokens();
  return (
    <View style={{ backgroundColor: c.surface, borderRadius: 14, padding: 14, gap: 10 }}>
      <View style={{ flexDirection: 'row', gap: 12 }}>
        <Artwork hue={item.hue} size={88} radius={8} />
        <View style={{ flex: 1, gap: 4 }}>
          <Text numberOfLines={1} style={{ fontSize: 16, fontWeight: '600', color: c.ink }}>{item.t}</Text>
          <Text numberOfLines={1} style={{ fontSize: 13, color: c.sub }}>{item.a + sep + item.l}</Text>
          <AvatarStack initials={item.buyers} ring={c.surface} />
        </View>
      </View>
      <Text style={{ fontSize: 14, color: c.sub }}>
        <Text style={{ fontWeight: '700', color: c.ink }}>{item.lead}</Text>
        {item.rest}
      </Text>
    </View>
  );
}

export function QuoteLine({ quote }: { quote: Quote }) {
  const { c, type } = useTokens();
  return (
    <View style={{ flexDirection: 'row', gap: 12, paddingHorizontal: type.gutter, paddingVertical: 12 }}>
      <Artwork hue={quote.hue} size={56} radius={4} />
      <View style={{ flex: 1, gap: 4 }}>
        <Text style={{ fontSize: 13, color: c.sub }}>
          <Text style={{ fontWeight: '600', color: c.ink }}>{quote.who}</Text>
          {copy.feed.quoteOn + [quote.t, quote.a, quote.when].join(sep)}
        </Text>
        <Text style={{ fontSize: 15, fontStyle: 'italic', color: c.ink }}>{copy.feed.quoted(quote.q)}</Text>
      </View>
    </View>
  );
}

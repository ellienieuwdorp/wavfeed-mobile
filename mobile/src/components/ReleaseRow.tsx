/**
 * One Release as a two-line list cell: artwork that plays it, "Title · Artist", a detail line, and the heart trailing
 * (the v2 client canvas, iOS and Android boards). The detail line is a slot so New releases and Bought share the cell.
 */
import type { ReactNode } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { copy, sep } from '@/copy';
import { hueFor, releaseArtUrl } from '@/lib/format';
import { useTokens } from '@/theme/tokens';

import { Artwork } from './Artwork';
import { Heart } from './Heart';
import { playableItemType, usePlay, type RowRelease } from './playable';

const ios = Platform.OS === 'ios';

/** The heart lane's props for a Release: its key and its title for the label. */
export function heartFor(release: RowRelease) {
  return { itemType: playableItemType(release.itemType), itemId: release.itemId, title: release.title };
}

export function ReleaseRow({ release, detail }: { release: RowRelease; detail: ReactNode }) {
  const { c, type } = useTokens();
  const play = usePlay();
  const rule = ios ? { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border } : null;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: ios ? 60 : 64, paddingLeft: type.gutter, paddingRight: ios ? 8 : 4, gap: ios ? 12 : 16 }}>
      <Pressable onPress={() => play(release)} accessibilityRole="button" accessibilityLabel={copy.play(release.title)} hitSlop={4}>
        <Artwork hue={hueFor(release.itemId)} url={releaseArtUrl(release.artId)} size={ios ? 44 : 40} radius={ios ? 6 : 8} />
      </Pressable>
      <View style={[{ flex: 1, alignSelf: 'stretch', flexDirection: 'row', alignItems: 'center' }, rule]}>
        <View style={{ flex: 1, gap: 2, paddingVertical: 8 }}>
          <Text numberOfLines={1} style={{ fontSize: type.rowTitle, color: c.ink }}>
            <Text style={{ fontWeight: ios ? '600' : '500' }}>{release.title}</Text>
            <Text style={{ color: c.sub }}>{sep + release.artist}</Text>
          </Text>
          {detail}
        </View>
        <Heart {...heartFor(release)} />
      </View>
    </View>
  );
}

export function FactLine({ parts }: { parts: (string | null | undefined)[] }) {
  const { c, type } = useTokens();
  return (
    <Text numberOfLines={1} style={{ fontSize: type.fact, color: c.sub }}>
      {parts.filter(Boolean).join(sep)}
    </Text>
  );
}

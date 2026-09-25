/**
 * One Feed Item as a two-line list cell: artwork, "Title · Artist", a detail
 * line, and the heart trailing (the v2 client canvas, iOS and Android boards).
 * The detail line is a slot so New releases and Bought share the cell.
 */
import type { ReactNode } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';

import { sep } from '@/copy';
import type { Release } from '@/mock/data';
import { useTokens } from '@/theme/tokens';

import { Artwork } from './Artwork';
import { Heart } from './Heart';

const ios = Platform.OS === 'ios';

export function ReleaseRow({ release, detail }: { release: Release; detail: ReactNode }) {
  const { c, type } = useTokens();
  const rule = ios ? { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border } : null;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: ios ? 60 : 64, paddingLeft: type.gutter, paddingRight: ios ? 8 : 4, gap: ios ? 12 : 16 }}>
      <Artwork hue={release.hue} size={ios ? 44 : 40} radius={ios ? 6 : 8} />
      <View style={[{ flex: 1, alignSelf: 'stretch', flexDirection: 'row', alignItems: 'center' }, rule]}>
        <View style={{ flex: 1, gap: 2, paddingVertical: 8 }}>
          <Text numberOfLines={1} style={{ fontSize: type.rowTitle, color: c.ink }}>
            <Text style={{ fontWeight: ios ? '600' : '500' }}>{release.t}</Text>
            <Text style={{ color: c.sub }}>{sep + release.a}</Text>
          </Text>
          {detail}
        </View>
        <Heart title={release.t} initial={release.on} />
      </View>
    </View>
  );
}

export function FactLine({ parts }: { parts: string[] }) {
  const { c, type } = useTokens();
  return (
    <Text numberOfLines={1} style={{ fontSize: type.fact, color: c.sub }}>
      {parts.filter(Boolean).join(sep)}
    </Text>
  );
}

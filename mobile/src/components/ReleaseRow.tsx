/**
 * One Release as a two-line list cell: artwork, "Title · Artist", a detail line, and the heart trailing (the v2 client
 * canvas, iOS and Android boards). A press anywhere but the heart plays it, with the system grey flash on iOS and
 * the ripple on Android, where the row is one TalkBack element beside its heart; the iOS separator starts at the text
 * edge. New releases and Bought share it via the detail slot.
 */
import type { ReactNode } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { copy, sep } from '@/copy';
import { hueFor, releaseArtUrl } from '@/lib/format';
import { PRESS_FLASH, ripple, SCROLL_PRESS_DELAY_MS, useTokens } from '@/theme/tokens';

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
  const art = <Artwork hue={hueFor(release.itemId)} url={releaseArtUrl(release.artId)} size={ios ? 44 : 40} radius={ios ? 6 : 8} />;
  return (
    <Pressable
      onPress={() => play(release)}
      accessible={!ios}
      accessibilityRole={ios ? undefined : 'button'}
      unstable_pressDelay={SCROLL_PRESS_DELAY_MS}
      android_ripple={ripple(c.track)}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', minHeight: ios ? 60 : 64, paddingLeft: type.gutter, paddingRight: ios ? 8 : 4, gap: ios ? 12 : 16, backgroundColor: pressed ? PRESS_FLASH : undefined })}
    >
      {ios ? (
        <Pressable onPress={() => play(release)} accessibilityRole="button" accessibilityLabel={copy.play(release.title)} hitSlop={4}>
          {art}
        </Pressable>
      ) : (
        art
      )}
      <View style={[{ flex: 1, alignSelf: 'stretch', flexDirection: 'row', alignItems: 'center' }, rule]}>
        <View style={{ flex: 1, gap: 2, paddingVertical: 8 }}>
          <Text numberOfLines={1} style={{ fontSize: type.rowTitle, lineHeight: type.rowTitleLine, color: c.ink }}>
            <Text style={{ fontWeight: ios ? '600' : '500' }}>{release.title}</Text>
            <Text style={{ color: c.sub }}>{sep + release.artist}</Text>
          </Text>
          {detail}
        </View>
        <Heart {...heartFor(release)} />
      </View>
    </Pressable>
  );
}

export function FactLine({ parts }: { parts: (string | null | undefined)[] }) {
  const { c, type } = useTokens();
  return (
    <Text numberOfLines={1} style={{ fontSize: type.fact, lineHeight: type.factLine, color: c.sub }}>
      {parts.filter(Boolean).join(sep)}
    </Text>
  );
}

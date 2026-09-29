/**
 * One Release as a two-line list cell: artwork, "Title · Artist", a detail line, and the heart trailing (the v2 client
 * canvas, iOS and Android boards). The art is the row's play control (PlayArt, DESIGN-UI section 11); a press on the
 * body plays too, lighting the whole row in the track tone on the UI thread on iOS and drawing the ripple on Android,
 * where the body is one TalkBack element beside the art and the heart. The art, the body and the heart sit side by
 * side, none inside another's Pressable. The iOS separator starts at the text edge. A long press on the art or the
 * body opens the row menu (see RowMenu). New releases and Bought share it via the detail slot. A Drop's row starts at
 * the Track `from` names and its art speaks the facts in `spoken` (task 0041, decision 10).
 */
import type { ReactNode } from 'react';
import { Platform, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';

import { sep } from '@/copy';
import { usePressMotion } from '@/player/motion';
import { ripple, SCROLL_PRESS_DELAY_MS, useTokens } from '@/theme/tokens';

import { Heart } from './Heart';
import { PlayArt } from './PlayArt';
import { playableItemType, usePlay, type RowRelease } from './playable';
import { RowMenu } from './RowMenu';

const ios = Platform.OS === 'ios';

/**
 * Spread on a FlatList of these rows or of Upcoming's cards: `strictMode` memoises FlatList's row renderer (react-native
 * Lists/FlatList.js), so with a stable `renderItem` a mounted row re-renders only when its item does, not whenever the
 * screen does. The types in use do not declare the prop yet, hence the cast. `removeClippedSubviews`, on by default on Android, detaches and reattaches cells
 * as they scroll, which leaves a Compose host inside one (the row menu, Bought's threshold chip) with no window position:
 * the chip draws blank and every Compose menu opens empty at the window's corner until a configuration change.
 */
export const ROW_LIST = { strictMode: true, removeClippedSubviews: false } as object;

/** The heart lane's props for a Release: its key, its title for the label, and the row it sits on. */
export function heartFor(release: RowRelease) {
  return { itemType: playableItemType(release.itemType), itemId: release.itemId, title: release.title, surface: 'row' as const };
}

type RowProps = {
  release: RowRelease;
  detail: ReactNode;
  /** The Track a press starts at; the first that streams when absent. */
  from?: string | null;
  /** From spokenFacts: what the art's label says after the title. */
  spoken?: string;
};

export function ReleaseRow({ release, detail, from, spoken }: RowProps) {
  const { c, type } = useTokens();
  const play = usePlay();
  const rule = ios ? { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border } : null;
  const { width } = useWindowDimensions();
  const { progress, onPressIn, onPressOut } = usePressMotion();
  const lit = useAnimatedStyle(() => ({ opacity: Math.max(0, progress.get()) }));
  const height = ios ? 60 : 64;
  const art = ios ? 44 : 40;
  const gap = ios ? 12 : 16;
  const slop = (height - art) / 2;
  return (
    <RowMenu release={release} width={width}>
      {(openMenu) => (
        <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: height, paddingLeft: type.gutter, paddingRight: ios ? 8 : 4, gap }}>
          {ios ? <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: c.track }, lit]} /> : null}
          <PlayArt release={release} size={art} radius={ios ? 6 : 8} onLongPress={openMenu} from={from} spoken={spoken} hitSlop={{ top: slop, bottom: slop, left: type.gutter }} />
          <View style={[{ flex: 1, alignSelf: 'stretch', flexDirection: 'row', alignItems: 'center' }, rule]}>
            <Pressable
              onPress={() => play(release, from)}
              onLongPress={openMenu}
              onPressIn={ios ? onPressIn : undefined}
              onPressOut={ios ? onPressOut : undefined}
              unstable_pressDelay={SCROLL_PRESS_DELAY_MS}
              hitSlop={{ left: gap }}
              accessible={!ios}
              accessibilityRole={ios ? undefined : 'button'}
              android_ripple={ripple(c.track)}
              style={{ flex: 1, alignSelf: 'stretch', justifyContent: 'center', gap: 2, paddingVertical: 8 }}
            >
              <Text numberOfLines={1} style={{ fontSize: type.rowTitle, lineHeight: type.rowTitleLine, color: c.ink }}>
                <Text style={{ fontWeight: ios ? '600' : '500' }}>{release.title}</Text>
                <Text style={{ color: c.sub }}>{sep + release.artist}</Text>
              </Text>
              {detail}
            </Pressable>
            <Heart {...heartFor(release)} />
          </View>
        </View>
      )}
    </RowMenu>
  );
}

/** `trailing` keeps its own Text, faint, so the joined facts truncate before it does (DESIGN-UI section 3). */
export function FactLine({ parts, trailing }: { parts: (string | null | undefined)[]; trailing?: string | null }) {
  const { c, type } = useTokens();
  const style = { fontSize: type.fact, lineHeight: type.factLine };
  const line = (
    <Text numberOfLines={1} style={[style, { color: c.sub }, trailing ? { flexShrink: 1 } : null]}>
      {parts.filter(Boolean).join(sep)}
    </Text>
  );
  if (!trailing) return line;
  return (
    <View style={{ flexDirection: 'row' }}>
      {line}
      <Text numberOfLines={1} style={[style, { flexShrink: 0, color: c.faint }]}>
        {sep + trailing}
      </Text>
    </View>
  );
}

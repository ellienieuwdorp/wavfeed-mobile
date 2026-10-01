/**
 * One Release as a two-line list cell: artwork, "Title · Artist", a detail line, and the heart trailing (the v2 client
 * canvas, iOS and Android boards). The art is the row's play control (PlayArt, DESIGN-UI section 11); a press on the
 * body plays too, lighting the whole row in the track tone on the UI thread on iOS and drawing the ripple on Android,
 * where the body is one TalkBack element beside the art and the heart, carrying the row menu's items as its actions.
 * On iOS VoiceOver meets the whole row as one element that names the Release, its Page, `facts` and whether it is on
 * the wishlist, plays on activation and carries the same actions (VIS-9). The art, the body and the heart sit side by
 * side, none inside another's Pressable. The iOS separator starts at the text edge. A long press on the art or the body
 * opens the row menu (see RowMenu). New releases and Bought share it via the detail slot. A Drop's row starts at the
 * Track `from` names and its art speaks the facts in `spoken` (task 0041, decision 10).
 */
import type { ReactNode } from 'react';
import { Platform, Pressable, StyleSheet, Text, useWindowDimensions, View, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';

import { copy, sep, spokenFacts } from '@/copy';
import type { ApiFanRef } from '@/domain/apiTypes';
import { usePressMotion } from '@/player/motion';
import { ripple, SCROLL_PRESS_DELAY_MS, useTokens } from '@/theme/tokens';
import { useMembership, usePendingAction } from '@/wishlist/state';

import { Heart } from './Heart';
import { PlayArt, useArtState } from './PlayArt';
import { playableItemType, usePlay, type RowRelease } from './playable';
import { heardWishlist, type SpokenActions } from './rowActions';
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
  /** From spokenFacts: the detail line as VoiceOver hears the iOS row, `spoken` when absent. */
  facts?: string;
  /** The Fans the detail line's faces name, offered to a screen reader as Bought by. */
  boughtBy?: readonly ApiFanRef[];
};

type Spoken = { release: RowRelease; facts: string | undefined; onActivate: () => void; actions: SpokenActions };

/**
 * The iOS row as one VoiceOver element (VIS-9): "Play Title by Page", the facts and the hidden heart's state, activation
 * playing and the menu's items as its actions; touch still lands on the art, the body and the heart inside it. Only
 * SpokenRow reads the transport and the wishlist, so a new play or press re-renders the element and not the cells it
 * wraps. Android's row is a plain View.
 */
function RowElement({ spoken, style, children }: { spoken: Spoken | null; style: ViewStyle; children: ReactNode }) {
  if (spoken === null) return <View style={style}>{children}</View>;
  return (
    <SpokenRow {...spoken} style={style}>
      {children}
    </SpokenRow>
  );
}

function SpokenRow({ release, facts, onActivate, actions, style, children }: Spoken & { style: ViewStyle; children: ReactNode }) {
  const { pause, watch } = useArtState(release);
  const membership = useMembership(release.itemType, release.itemId);
  const pending = usePendingAction(release.itemType, release.itemId);
  const named = copy.titleBy(release.title, release.artist);
  const heard = spokenFacts([facts, heardWishlist(membership, pending)]);
  return (
    <View
      accessible
      accessibilityRole="button"
      accessibilityLabel={pause ? copy.pause(named, heard) : copy.play(named, heard)}
      onAccessibilityTap={onActivate}
      {...actions}
      style={style}
    >
      {watch}
      {children}
    </View>
  );
}

export function ReleaseRow({ release, detail, from, spoken, facts, boughtBy }: RowProps) {
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
    <RowMenu release={release} width={width} boughtBy={boughtBy}>
      {(openMenu, actions) => (
        <RowElement
          spoken={ios ? { release, facts: facts ?? spoken, onActivate: () => play(release, from), actions } : null}
          style={{ flexDirection: 'row', alignItems: 'center', minHeight: height, paddingLeft: type.gutter, paddingRight: ios ? 8 : 4, gap }}
        >
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
              {...(ios ? null : actions)}
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
        </RowElement>
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

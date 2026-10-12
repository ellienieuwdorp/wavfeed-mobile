/**
 * One Release as a list cell of three lines and a right edge (task 0071, decisions 10 to 13, the R5 canvas): 56pt art,
 * then the day in small caps, the title and the credit line ("artist · Page or label", creditText). A Drop's "1/4" pill
 * ends at the right edge on the title line and the faces of who bought it end at the same edge on the credit line, so
 * the title truncates against the pill and the credit line against the faces. No heart: a swipe right wishlists (WishlistSwipe,
 * decision 15), and the long press menu and the screen reader's actions keep the item. The art is the row's play control (PlayArt, DESIGN-UI section 11); a
 * press on the body plays too, lighting the whole row in the track tone on the UI thread on iOS and drawing the ripple on
 * Android. The row in the transport stays lit. On iOS VoiceOver meets the whole row as one element and on Android the
 * body is one TalkBack button beside the art; both say the whole row (heardRow) and carry the row menu's items as their
 * actions (VIS-9). The art and the body sit side by side, neither inside the other's Pressable. The iOS hairline runs
 * from the text column to the screen's edge, left out where `rule` is false (above a week head) and around the row in
 * the transport. A long press on the art or the body opens the row menu (see RowMenu). A Drop's row starts at the Track
 * `from` names (task 0041, decision 10).
 */
import type { ReactNode } from 'react';
import { Platform, Pressable, StyleSheet, useWindowDimensions, View, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';

import { creditText, spokenFacts, tracksOutPhrase, tracksOutPill } from '@/copy';
import type { ApiFanRef } from '@/domain/apiTypes';
import { usePressMotion } from '@/player/motion';
import { ripple, rowText, SCROLL_PRESS_DELAY_MS, useTokens } from '@/theme/tokens';
import { useMembership } from '@/wishlist/state';

import { AvatarStack } from './AvatarStack';
import { PlayArt, useArtState, useInTransport } from './PlayArt';
import { creditOf, usePlay, type RowRelease } from './playable';
import { heardRow, type HeardRow, type SpokenActions } from './rowActions';
import { RowMenu } from './RowMenu';
import { Type } from './Type';
import { useHiddenWhileSwiped, WishlistSwipe } from './WishlistSwipe';

const ios = Platform.OS === 'ios';
const ART = 56;
const GAP = ios ? 12 : 16;
const MIN_HEIGHT = ios ? 68 : 72;
const TRAILING = 16;
/** The iOS hairline starts at the text column: the 20pt gutter, the art and the gap. */
const RULE_LEFT = 20 + ART + GAP;

/**
 * Spread on a FlatList of these rows or of Upcoming's cards: `strictMode` memoises FlatList's row renderer (react-native
 * Lists/FlatList.js), so with a stable `renderItem` a mounted row re-renders only when its item does, not whenever the
 * screen does. The types in use do not declare the prop yet, hence the cast. `removeClippedSubviews`, on by default on Android, detaches and reattaches cells
 * as they scroll, which leaves a Compose host inside one (the row menu) with no window position:
 * every Compose menu opens empty at the window's corner until a configuration change.
 */
export const ROW_LIST = { strictMode: true, removeClippedSubviews: false } as object;

type RowProps = {
  release: RowRelease;
  /** The eyebrow: "Wed 7" from dayLabel, or "out Tue 13 Oct" from outOnPhrase for a Drop or a Release not out yet. */
  day: string | null;
  /** The Tracks of a Drop or an Upcoming Release that play, and how many it has: the "1/4" pill. */
  tracksOut?: number | null;
  numTracks?: number | null;
  /** The people you follow who bought it, as the faces. */
  buyers: readonly ApiFanRef[];
  /** The Track a press starts at; the first that streams when absent. */
  from?: string | null;
  /** The iOS hairline under the row; false above a week head or anything else that is not a row. */
  rule: boolean;
};

/**
 * The "1/4" pill (task 0071, decision 12): tabular figures in a 1pt border on the surface. A row's pill in the dark sits
 * on the row itself (`onRow`); a card's keeps the surface, as CSS5 draws them.
 */
export function Pill({ text, onRow = false }: { text: string; onRow?: boolean }) {
  const { c, dark } = useTokens();
  return (
    <View style={{ marginLeft: 'auto', flexShrink: 0, borderWidth: 1, borderColor: c.border, borderRadius: 5, paddingVertical: 2, paddingHorizontal: 5, backgroundColor: dark && onRow ? 'transparent' : c.surface }}>
      <Type style={{ fontSize: 11.5, lineHeight: 12, fontWeight: '600', letterSpacing: 0.23, fontVariant: ['tabular-nums'], includeFontPadding: false, color: c.sub }}>{text}</Type>
    </View>
  );
}

/** The faces at a line's right end, 2pt in from it as the canvas draws them. */
export function Faces({ fans, cap }: { fans: readonly ApiFanRef[]; cap?: number }) {
  if (fans.length === 0) return null;
  return (
    <View style={{ marginLeft: 'auto', marginRight: 2, flexShrink: 0 }}>
      <AvatarStack fans={fans} cap={cap} opens />
    </View>
  );
}

/** The label the iOS row and the Android body say, kept current with the transport and the wishlist. */
function useHeard(release: RowRelease, heard: HeardRow): { label: string; watch: ReactNode } {
  const { pause, watch } = useArtState(release);
  const membership = useMembership(release.itemType, release.itemId);
  return { label: heardRow(heard, membership, pause), watch };
}

type Spoken = { release: RowRelease; heard: HeardRow; onActivate: () => void; actions: SpokenActions };

/**
 * The iOS row as one VoiceOver element (VIS-9): activation plays and the menu's items are its actions; touch still lands
 * on the art and the body inside it. Only it reads the transport and the wishlist, so a new play or press re-renders
 * the element and not the cells it wraps.
 */
function SpokenRow({ release, heard, onActivate, actions, style, children }: Spoken & { style: ViewStyle; children: ReactNode }) {
  const { label, watch } = useHeard(release, heard);
  return (
    <View accessible accessibilityRole="button" accessibilityLabel={label} onAccessibilityTap={onActivate} {...actions} style={style}>
      {watch}
      {children}
    </View>
  );
}

/** Android's body as one TalkBack button saying the whole row, the menu's items as its actions. */
function TalkBackBody({ release, heard, actions, onPress, onLongPress, children }: { release: RowRelease; heard: HeardRow; actions: SpokenActions; onPress: () => void; onLongPress: () => void; children: ReactNode }) {
  const { c } = useTokens();
  const { label, watch } = useHeard(release, heard);
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      unstable_pressDelay={SCROLL_PRESS_DELAY_MS}
      hitSlop={{ left: GAP }}
      accessibilityRole="button"
      accessibilityLabel={label}
      {...actions}
      android_ripple={ripple(c.track)}
      style={BODY}
    >
      {watch}
      {children}
    </Pressable>
  );
}

/** The art's press area is the row's full height, the art centred in it, so no strip above or below it is dead. */
const ART_COLUMN: ViewStyle = { alignSelf: 'stretch', justifyContent: 'center' };

const BODY: ViewStyle = { flex: 1, alignSelf: 'stretch', justifyContent: 'center', gap: 1, paddingVertical: 9 };

/**
 * The row in the transport, lit in the track tone with no hairline under it; on iOS it also covers the hairline of the
 * row above, which later cells draw over. Only it reads the transport, so a new play re-renders it and not the row. The
 * hairline leaves while the row's swipe moves it (WishlistSwipe).
 */
function RowLight({ release, rule }: { release: RowRelease; rule: boolean }) {
  const { c } = useTokens();
  const live = useInTransport(release);
  const swiped = useHiddenWhileSwiped();
  return (
    <>
      {live ? <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: c.track }]} /> : null}
      {ios && live ? <View pointerEvents="none" style={[styles.cover, { backgroundColor: c.bg }]} /> : null}
      {ios && rule && !live ? <Animated.View pointerEvents="none" style={[styles.rule, { backgroundColor: c.border }, swiped]} /> : null}
    </>
  );
}

const styles = StyleSheet.create({
  cover: { position: 'absolute', left: 0, right: 0, top: -StyleSheet.hairlineWidth, height: StyleSheet.hairlineWidth },
  rule: { position: 'absolute', left: RULE_LEFT, right: 0, bottom: 0, height: StyleSheet.hairlineWidth },
});

export function ReleaseRow({ release, day, tracksOut = null, numTracks = null, buyers, from, rule }: RowProps) {
  const { c, type } = useTokens();
  const play = usePlay();
  const { width } = useWindowDimensions();
  const { progress, onPressIn, onPressOut } = usePressMotion();
  const lit = useAnimatedStyle(() => ({ opacity: Math.max(0, progress.get()) }));
  const credit = creditOf(release);
  const count = tracksOutPhrase(tracksOut, numTracks);
  const pill = tracksOutPill(tracksOut, numTracks);
  const heard: HeardRow = { title: release.title, credit, day, count, buyers };
  const lines = (
    <>
      {day ? (
        <Type numberOfLines={1} style={[rowText.eyebrow, { color: c.faint, marginBottom: 1 }]}>
          {day}
        </Type>
      ) : null}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <Type numberOfLines={1} style={[rowText.title, { flexShrink: 1, color: c.ink }]}>
          {release.title}
        </Type>
        {pill ? <Pill text={pill} onRow /> : null}
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Type numberOfLines={1} style={[rowText.credit, { flexShrink: 1, color: c.sub }]}>
          {creditText(credit)}
        </Type>
        <Faces fans={buyers} />
      </View>
    </>
  );
  const row: ViewStyle = { flexDirection: 'row', alignItems: 'center', minHeight: MIN_HEIGHT, paddingLeft: type.gutter, paddingRight: TRAILING, gap: GAP };
  return (
    <RowMenu release={release} width={width} boughtBy={buyers}>
      {(openMenu, actions) => {
        const art = (
          <PlayArt
            release={release}
            size={ART}
            radius={ios ? 6 : 8}
            onLongPress={openMenu}
            from={from}
            spoken={count === null ? undefined : spokenFacts([count, day])}
            hitSlop={{ left: type.gutter }}
            style={ART_COLUMN}
          />
        );
        if (!ios) {
          return (
            <WishlistSwipe release={release} width={width}>
              <View style={row}>
                <RowLight release={release} rule={rule} />
                {art}
                <TalkBackBody release={release} heard={heard} actions={actions} onPress={() => play(release, from)} onLongPress={openMenu}>
                  {lines}
                </TalkBackBody>
              </View>
            </WishlistSwipe>
          );
        }
        return (
          <WishlistSwipe release={release} width={width}>
            <SpokenRow release={release} heard={heard} onActivate={() => play(release, from)} actions={actions} style={row}>
              <RowLight release={release} rule={rule} />
              <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: c.track }, lit]} />
              {art}
              <Pressable
                onPress={() => play(release, from)}
                onLongPress={openMenu}
                onPressIn={onPressIn}
                onPressOut={onPressOut}
                unstable_pressDelay={SCROLL_PRESS_DELAY_MS}
                hitSlop={{ left: GAP }}
                accessible={false}
                style={BODY}
              >
                {lines}
              </Pressable>
            </SpokenRow>
          </WishlistSwipe>
        );
      }}
    </RowMenu>
  );
}

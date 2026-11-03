/**
 * A Release's artwork as its play control (DESIGN-UI section 11): a press plays or toggles it, a long press opens the
 * row menu, and the art shrinks to PRESS_SCALE under a shade on the UI thread (src/player/motion.ts). Only the art of
 * the Release in the transport draws a state, pause while it plays or loads, else play, and only it reads usePlayer
 * (useArtState), so other art re-renders only when another Release plays. `badge`, `day` and `faces` sit on its corners
 * at a fixed size. Inside a row's swipe a press plays nothing for a touch the swipe took (useTakenBySwipe), and nothing
 * above it may be a Pressable (RowSurface). A screen reader finds the row menu's items as its actions (VIS-9, FLOW-13).
 */
import { useLayoutEffect, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View, type Insets, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';

import { copy } from '@/copy';
import { hueFor, releaseArtUrl } from '@/lib/format';
import { PRESS_SCALE, PRESS_SHADE, usePressMotion, useReduceMotion } from '@/player/motion';
import { ON_ART, SCROLL_PRESS_DELAY_MS } from '@/theme/tokens';

import { Artwork } from './Artwork';
import { Glyph, type GlyphName } from './Glyph';
import { showsPause } from './player/MiniPlayer';
import { usePlayer, usePlayerRelease } from './player/playerState';
import type { PlayableRelease } from '../player/transport';
import { playableItemType, usePlay, type RowRelease } from './playable';
import { useSpokenActions, type OpenMenu } from './RowMenu';
import { useTakenBySwipe } from './WishlistSwipe';

/**
 * Art from this size up takes the card's badge; the 56 rows take the small one. The Feed's quotes carry no badge: a
 * quote holds no Track counts or release day (CuratedQuote).
 */
const LARGE_ART = 80;
/** How far a mark sits in from the art's edges: 6 on the card's art and up, 3 on a row's. */
function artInset(size: number): number {
  return size >= LARGE_ART ? 6 : 3;
}
const SHADE = '#000000';
const SCRIM = 'rgba(0,0,0,0.38)';

type Props = {
  release: RowRelease;
  size: number;
  radius: number;
  onLongPress: OpenMenu;
  /** The Track a press starts at, a Drop's newest; the first that streams when absent. */
  from?: string | null;
  /** What the label names before its facts: "Title by Artist" on an Upcoming card (heardParts); the title when absent. */
  named?: string;
  /** Facts the label speaks after the name, from spokenFacts: a card's credit, day, count and buyers. */
  spoken?: string;
  /** "1/4" from tracksOutBadge: a partial Release's count on the bottom-left corner. */
  badge?: string | null;
  /** "13 Oct" from onDayPhrase: an Upcoming card's day, in capitals on the top-left corner. */
  day?: string | null;
  /** An Upcoming card's faces on the top-right corner, pressed apart from the art. */
  faces?: ReactNode;
  hitSlop?: Insets | number;
  style?: StyleProp<ViewStyle>;
  children?: ReactNode;
};

function isCurrent(current: PlayableRelease | null, release: RowRelease): boolean {
  return current !== null && current.itemId === release.itemId && current.itemType === playableItemType(release.itemType);
}

/**
 * A mark on the art's bottom-left corner, or its top-left one; the day reads in capitals as on a row. On
 * large art it stands as tall as the faces' backing, its figures centred (ON_ART.mark).
 */
function Badge({ text, size, corner }: { text: string; size: number; corner: 'bottomLeft' | 'topLeft' }) {
  const large = size >= LARGE_ART;
  const inset = artInset(size);
  const at = corner === 'bottomLeft' ? { left: inset, bottom: inset } : { left: inset, top: inset };
  return (
    <View pointerEvents="none" style={{ position: 'absolute', ...at, borderRadius: large ? 6 : 4, borderCurve: 'continuous', paddingHorizontal: large ? 5 : 3, height: large ? ON_ART.mark : undefined, justifyContent: 'center', backgroundColor: ON_ART.ground }}>
      <Text allowFontScaling={false} style={[large ? ON_ART.text : ON_ART.small, { color: ON_ART.ink, textTransform: 'uppercase' }]}>
        {text}
      </Text>
    </View>
  );
}

function Scrim({ size, radius, glyph }: { size: number; radius: number; glyph: GlyphName }) {
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { borderRadius: radius, backgroundColor: SCRIM, alignItems: 'center', justifyContent: 'center' }]}>
      <View style={{ marginLeft: glyph === 'play' ? Math.round(size * 0.03) : 0 }}>
        <Glyph name={glyph} size={Math.min(36, Math.round(size * 0.32))} colour={ON_ART.ink} />
      </View>
    </View>
  );
}

/** Mounted only for the Release in the transport: hands pause up before paint, so the glyph and the label never lag. */
function PauseWatch({ onPause }: { onPause: (pause: boolean) => void }) {
  const pause = showsPause(usePlayer());
  useLayoutEffect(() => onPause(pause), [pause, onPause]);
  return null;
}

export type ArtState = { live: boolean; pause: boolean; watch: ReactNode };

/** Whether `release` is the one in the transport, playing or not; it changes only when another Release plays. */
export function useInTransport(release: RowRelease): boolean {
  return isCurrent(usePlayerRelease(), release);
}

/** Whether `release` is the one in the transport and shows pause; render `watch` to keep `pause` current. */
export function useArtState(release: RowRelease): ArtState {
  const live = useInTransport(release);
  const [pause, setPause] = useState(false);
  return { live, pause: live && pause, watch: live ? <PauseWatch onPause={setPause} /> : null };
}

export function PlayArt({ release, size, radius, onLongPress, from, named, spoken, badge = null, day = null, faces = null, hitSlop, style, children }: Props) {
  const play = usePlay();
  const { live, pause, watch } = useArtState(release);
  const actions = useSpokenActions();
  const { progress, onPressIn, onPressOut } = usePressMotion();
  const reduced = useReduceMotion();
  const lift = useAnimatedStyle(() => ({ transform: [{ scale: reduced ? 1 : 1 - (1 - PRESS_SCALE) * progress.get() }] }));
  const shade = useAnimatedStyle(() => ({ opacity: Math.max(0, progress.get()) * PRESS_SHADE }));
  const taken = useTakenBySwipe();
  const glyph = pause ? 'pause' : 'play';
  return (
    <Pressable
      onPress={() => {
        if (!taken()) play(release, from);
      }}
      onLongPress={onLongPress}
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      unstable_pressDelay={SCROLL_PRESS_DELAY_MS}
      hitSlop={hitSlop}
      accessibilityRole="button"
      accessibilityLabel={pause ? copy.pause(named ?? release.title, spoken) : copy.play(named ?? release.title, spoken)}
      {...actions}
      style={style}
    >
      {watch}
      <Animated.View style={[{ width: size, height: size }, lift]}>
        <Artwork hue={hueFor(release.itemId)} url={releaseArtUrl(release.artId)} size={size} radius={radius} />
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { borderRadius: radius, backgroundColor: SHADE }, shade]} />
        {live ? <Scrim size={size} radius={radius} glyph={glyph} /> : null}
        {badge === null ? null : <Badge text={badge} size={size} corner="bottomLeft" />}
        {day === null ? null : <Badge text={day} size={size} corner="topLeft" />}
        {faces === null ? null : <View style={{ position: 'absolute', right: artInset(size), top: artInset(size) }}>{faces}</View>}
      </Animated.View>
      {children}
    </Pressable>
  );
}

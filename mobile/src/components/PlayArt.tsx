/**
 * A Release's artwork as its play control, the one way to play a Release wherever one is drawn (DESIGN-UI section 11,
 * the art plays): a press plays it or toggles it when it is already in the transport, a long press opens the row menu,
 * and the art answers a press by shrinking to PRESS_SCALE under a light shade on the UI thread (src/player/motion.ts),
 * after the scrolling lists' short press delay. Art at CORNER_MIN or larger carries a small play badge in its corner,
 * accent filled while its Release is the one in the transport; smaller art draws the state only while it is that one,
 * as a scrim with the glyph. Pause shows while the transport plays or loads (showsPause), play otherwise, a dead
 * Release included, since a press on it asks again. Only the art in the transport reads usePlayer (useArtState); every
 * other one reads the Release alone, whose identity changes only when another Release plays. Nothing above it may be a
 * Pressable taking the tap (RowSurface in RowMenu.tsx); `children` draw under the art inside the same control, as a
 * cover's captions do. A screen reader finds the row menu's items as its actions (VIS-9, FLOW-13).
 */
import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import { useLayoutEffect, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, View, type Insets, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';

import { copy } from '@/copy';
import { hueFor, releaseArtUrl } from '@/lib/format';
import { PRESS_SCALE, PRESS_SHADE, usePressMotion, useReduceMotion } from '@/player/motion';
import { SCROLL_PRESS_DELAY_MS, useTokens } from '@/theme/tokens';

import { Artwork } from './Artwork';
import { Glyph, type GlyphName } from './Glyph';
import { showsPause } from './player/MiniPlayer';
import { usePlayer, usePlayerRelease, type PlayableRelease } from './player/playerState';
import { playableItemType, usePlay, type RowRelease } from './playable';
import { useSpokenActions, type OpenMenu } from './RowMenu';

/** The smallest art with room for a corner badge: the Feed's covers and cards have it, its quotes and the list rows do not. */
const CORNER_MIN = 80;
/** Art is any colour in either theme, so its marks are white over black. */
const ON_ART = '#ffffff';
const SHADE = '#000000';
const SCRIM = 'rgba(0,0,0,0.38)';
const BADGE_FALLBACK = 'rgba(0,0,0,0.45)';

type Props = {
  release: RowRelease;
  size: number;
  radius: number;
  onLongPress: OpenMenu;
  /** The Track a press starts at, a Drop's newest (task 0041, decision 10); the first that streams when absent. */
  from?: string | null;
  /** Facts the label speaks after the title, from spokenFacts: an Upcoming card's count and release day (task 0041). */
  spoken?: string;
  hitSlop?: Insets | number;
  style?: StyleProp<ViewStyle>;
  children?: ReactNode;
};

function isCurrent(current: PlayableRelease | null, release: RowRelease): boolean {
  return current !== null && current.itemId === release.itemId && current.itemType === playableItemType(release.itemType);
}

function Corner({ size, glyph, live }: { size: number; glyph: GlyphName; live: boolean }) {
  const { c } = useTokens();
  const d = size >= 120 ? 30 : 26;
  const inset = size >= 120 ? 8 : 6;
  const shape = { position: 'absolute' as const, right: inset, bottom: inset, width: d, height: d, borderRadius: d / 2, overflow: 'hidden' as const, alignItems: 'center' as const, justifyContent: 'center' as const };
  // The play triangle's mass sits left of its box, so it moves right by a pixel or two to look centred.
  const mark = <View style={{ marginLeft: glyph === 'play' ? Math.round(d * 0.06) : 0 }}><Glyph name={glyph} size={Math.round(d * 0.42)} colour={live ? c.onAccent : ON_ART} /></View>;
  if (live) return <View pointerEvents="none" style={[shape, { backgroundColor: c.accent }]}>{mark}</View>;
  return (
    <GlassView pointerEvents="none" glassEffectStyle="regular" colorScheme="dark" style={[shape, isLiquidGlassAvailable() ? null : { backgroundColor: BADGE_FALLBACK }]}>
      {mark}
    </GlassView>
  );
}

function Scrim({ size, radius, glyph }: { size: number; radius: number; glyph: GlyphName }) {
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { borderRadius: radius, backgroundColor: SCRIM, alignItems: 'center', justifyContent: 'center' }]}>
      <View style={{ marginLeft: glyph === 'play' ? Math.round(size * 0.03) : 0 }}>
        <Glyph name={glyph} size={Math.round(size * 0.32)} colour={ON_ART} />
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

/** Whether `release` is the one in the transport and shows pause; render `watch` to keep `pause` current. */
export function useArtState(release: RowRelease): ArtState {
  const live = isCurrent(usePlayerRelease(), release);
  const [pause, setPause] = useState(false);
  return { live, pause: live && pause, watch: live ? <PauseWatch onPause={setPause} /> : null };
}

export function PlayArt({ release, size, radius, onLongPress, from, spoken, hitSlop, style, children }: Props) {
  const play = usePlay();
  const { live, pause, watch } = useArtState(release);
  const actions = useSpokenActions();
  const { progress, onPressIn, onPressOut } = usePressMotion();
  const reduced = useReduceMotion();
  const lift = useAnimatedStyle(() => ({ transform: [{ scale: reduced ? 1 : 1 - (1 - PRESS_SCALE) * progress.get() }] }));
  const shade = useAnimatedStyle(() => ({ opacity: Math.max(0, progress.get()) * PRESS_SHADE }));
  const glyph = pause ? 'pause' : 'play';
  return (
    <Pressable
      onPress={() => play(release, from)}
      onLongPress={onLongPress}
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      unstable_pressDelay={SCROLL_PRESS_DELAY_MS}
      hitSlop={hitSlop}
      accessibilityRole="button"
      accessibilityLabel={pause ? copy.pause(release.title, spoken) : copy.play(release.title, spoken)}
      {...actions}
      style={style}
    >
      {watch}
      <Animated.View style={[{ width: size, height: size }, lift]}>
        <Artwork hue={hueFor(release.itemId)} url={releaseArtUrl(release.artId)} size={size} radius={radius} />
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { borderRadius: radius, backgroundColor: SHADE }, shade]} />
        {size >= CORNER_MIN ? <Corner size={size} glyph={glyph} live={live} /> : live ? <Scrim size={size} radius={radius} glyph={glyph} /> : null}
      </Animated.View>
      {children}
    </Pressable>
  );
}

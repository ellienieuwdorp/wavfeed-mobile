/**
 * The mini player (DESIGN-UI section 10, task 0036 decision 5, the v2 client canvas): artwork, "N. Track title" over
 * the Page, play or pause, the heart for the playing Track. On iOS 26 it is the tab bar's bottom accessory in Apple
 * Music's grammar, whose glass the system draws; without it, a GlassView capsule of its own; on Android a raised
 * floating toolbar at elevation 3, one tone up from the surface in dark (the canvas's toolbar), with the ripple on the
 * whole bar and play as its one filled control. Every slot keeps its size from the first frame, so a play landing only
 * swaps glyphs and text.
 */
import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import { router } from 'expo-router';
import { NativeTabs } from 'expo-router/unstable-native-tabs';
import { Platform, Pressable, Text, View } from 'react-native';

import { Artwork } from '@/components/Artwork';
import { Glyph } from '@/components/Glyph';
import { Heart } from '@/components/Heart';
import { playerCopy } from '@/player/copy';
import { ON_GLASS, pressedOpacity, ripple, useTokens } from '@/theme/tokens';

import { usePlayer, usePlayerRelease, type Player, type PlayableRelease } from './playerState';

const ios = Platform.OS === 'ios';

export const CAPSULE = ios ? 56 : 64;

export function playerInAccessory(): boolean {
  return ios && isLiquidGlassAvailable();
}

/** The line under the title: the Page, or the note when nothing can play (DESIGN-UI section 10). */
export function playerNote(player: Pick<Player, 'status'>): string | null {
  if (player.status === 'unplayable') return playerCopy.unplayable;
  if (player.status === 'error') return playerCopy.error;
  return null;
}

export function trackLine(player: Pick<Player, 'track'>, release: PlayableRelease): string {
  return player.track === null ? release.title : playerCopy.trackTitle(player.track.trackNum, player.track.title);
}

/** A loading play already shows pause, so the glyph flips once when the press lands and not again when audio starts. */
export function showsPause(player: Pick<Player, 'playing' | 'status'>): boolean {
  return player.playing || player.status === 'loading';
}

export function isDead(player: Pick<Player, 'status'>): boolean {
  return player.status === 'unplayable' || player.status === 'error';
}

/** The playing Track's heart, absent while the tracklist loads or nothing can play (DESIGN-UI section 10); its box stays. */
export function TrackHeart({ release, box, icon }: { release: PlayableRelease; box: number; icon: number }) {
  const { track, status } = usePlayer();
  if (track !== null && track.trackId !== null && status === 'ready') {
    return <Heart itemType={release.itemType} itemId={release.itemId} trackId={track.trackId} title={track.title} box={box} icon={icon} />;
  }
  const side = Math.max(box, 44);
  return <View style={{ width: side, height: side }} />;
}

function PlayPause({ box, glyph, primary = false }: { box: number; glyph: number; primary?: boolean }) {
  const { c } = useTokens();
  const player = usePlayer();
  const pause = showsPause(player);
  const enabled = player.status === 'ready';
  return (
    <Pressable
      onPress={player.toggle}
      disabled={!enabled}
      hitSlop={4}
      accessibilityRole="button"
      accessibilityLabel={pause ? playerCopy.pause : playerCopy.play}
      accessibilityState={{ disabled: !enabled }}
      android_ripple={ripple(primary ? c.onAccent : c.track)}
      style={({ pressed }) => ({ width: box, height: box, borderRadius: primary ? 16 : box / 2, overflow: ios ? undefined : 'hidden', alignItems: 'center', justifyContent: 'center', backgroundColor: primary ? c.accent : undefined, opacity: pressedOpacity(pressed, isDead(player) ? 0.4 : 1) })}
    >
      <Glyph name={pause ? 'pause' : 'play'} size={glyph} colour={primary ? c.onAccent : c.ink} />
    </Pressable>
  );
}

/** On iOS every mini player sits on glass, so its words take the system's label colours (task 0040, decision 7). */
function Titles({ release, single = false }: { release: PlayableRelease; single?: boolean }) {
  const { c } = useTokens();
  const player = usePlayer();
  const note = playerNote(player);
  return (
    <View style={{ flex: 1, minWidth: 0, justifyContent: 'center' }}>
      <Text numberOfLines={1} style={{ fontSize: ios ? 15 : 14, lineHeight: 20, fontWeight: ios ? '600' : '500', color: ON_GLASS?.ink ?? c.ink }}>
        {trackLine(player, release)}
      </Text>
      {single ? null : (
        <Text numberOfLines={1} style={{ fontSize: ios ? 13 : 12, lineHeight: ios ? 17 : 16, color: ON_GLASS?.sub ?? c.sub }}>
          {note ?? release.artist}
        </Text>
      )}
    </View>
  );
}

function Contents({ release, inline = false }: { release: PlayableRelease; inline?: boolean }) {
  const { c } = useTokens();
  const art = ios ? (inline ? 26 : 34) : 48;
  return (
    <Pressable
      onPress={() => router.push('/player')}
      accessibilityRole="button"
      accessibilityLabel={playerCopy.open(release.title)}
      android_ripple={ripple(c.track)}
      style={({ pressed }) => ({ flex: 1, flexDirection: 'row', alignItems: 'center', gap: ios ? 10 : 12, paddingLeft: ios ? (inline ? 6 : 10) : 8, paddingRight: ios ? 4 : 8, borderRadius: ios ? undefined : CAPSULE / 2, overflow: ios ? undefined : 'hidden', opacity: pressedOpacity(pressed) })}
    >
      <Artwork hue={release.hue} url={release.artUrl} size={art} radius={ios ? (inline ? 5 : 6) : art / 2} />
      <Titles release={release} single={inline} />
      {ios ? (
        <>
          <PlayPause box={inline ? 36 : 44} glyph={inline ? 18 : 21} />
          {inline ? null : <TrackHeart release={release} box={44} icon={22} />}
        </>
      ) : (
        <>
          <TrackHeart release={release} box={48} icon={24} />
          <PlayPause box={48} glyph={24} primary />
        </>
      )}
    </Pressable>
  );
}

export function AccessoryPlayer() {
  const placement = NativeTabs.BottomAccessory.usePlacement();
  const current = usePlayerRelease();
  return current ? <Contents release={current} inline={placement === 'inline'} /> : null;
}

export function MiniPlayer() {
  const { c, dark } = useTokens();
  const current = usePlayerRelease();
  if (!current) return null;
  const shape = { height: CAPSULE, borderRadius: CAPSULE / 2, marginHorizontal: ios ? 14 : 16 };
  if (ios) {
    const glass = isLiquidGlassAvailable();
    return (
      <GlassView glassEffectStyle="regular" isInteractive tintColor={`${c.raised}66`} style={[shape, glass ? null : { backgroundColor: c.raised }]}>
        <Contents release={current} />
      </GlassView>
    );
  }
  return (
    <View style={[shape, { backgroundColor: dark ? c.borderLight : c.surface, boxShadow: '0 3px 6px rgba(0,0,0,0.18), 0 1px 3px rgba(0,0,0,0.12)' }]}>
      <Contents release={current} />
    </View>
  );
}

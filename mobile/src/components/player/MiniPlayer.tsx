/**
 * The mini player (DESIGN-UI section 10): artwork, "N. Track title" over the artist, and play or pause. On iOS 26 it
 * is the tab bar's bottom accessory, before that a GlassView capsule, and on Android a floating toolbar at elevation 3.
 * Every slot keeps its size from the first frame, so a play only swaps glyphs and text. VoiceOver reaches nothing
 * inside an element, so the art and titles are an open button beside play; TalkBack reaches into the bar (VIS-M1).
 * Before anything plays the accessory stands as "Nothing playing", one element that opens nothing (VIS-M4).
 */
import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import { router } from 'expo-router';
import { NativeTabs } from 'expo-router/unstable-native-tabs';
import { Platform, Pressable, Text, View } from 'react-native';

import { Artwork } from '@/components/Artwork';
import { Glyph } from '@/components/Glyph';
import { copy } from '@/copy';
import { playerCopy } from '@/player/copy';
import { playerNote, playPress, type PlayableRelease } from '@/player/transport';
import { ON_GLASS, pressedOpacity, ripple, useTokens } from '@/theme/tokens';

import { usePlayer, usePlayerRelease, type Player } from './playerState';

const ios = Platform.OS === 'ios';

export const CAPSULE = ios ? 56 : 64;

export function playerInAccessory(): boolean {
  return ios && isLiquidGlassAvailable();
}

export function trackLine(player: Pick<Player, 'track'>, release: PlayableRelease): string {
  return player.track === null ? release.title : playerCopy.trackTitle(player.track.trackNum, player.track.title);
}

/** A loading play already shows pause, so the glyph flips once when the press lands and not again when audio starts. */
export function showsPause(player: Pick<Player, 'playing' | 'status'>): boolean {
  return player.playing || player.status === 'loading';
}

export type PlayControl = { enabled: boolean; pause: boolean; dim: boolean; label: string; onPress: () => void };

/**
 * The play control of the mini player and the sheet (VIS-5): after an error a press asks again at the Track that failed,
 * which goes down the load path as the art's press does; only a Release with no preview is drawn dimmed.
 */
export function usePlayControl(): PlayControl {
  const player = usePlayer();
  const press = playPress(player.status);
  const pause = showsPause(player);
  return {
    enabled: press !== null,
    pause,
    dim: player.status === 'unplayable',
    label: press === 'retry' ? playerCopy.retry : pause ? playerCopy.pause : playerCopy.play,
    onPress: () => {
      if (press === 'toggle') player.toggle();
      else if (press === 'retry' && player.release !== null) player.play(player.release, player.track?.trackId ?? null);
    },
  };
}

function PlayPause({ box, glyph, primary = false }: { box: number; glyph: number; primary?: boolean }) {
  const { c } = useTokens();
  const control = usePlayControl();
  return (
    <Pressable
      onPress={control.onPress}
      disabled={!control.enabled}
      hitSlop={4}
      accessibilityRole="button"
      accessibilityLabel={control.label}
      accessibilityState={{ disabled: !control.enabled }}
      android_ripple={ripple(primary ? c.onAccent : c.track)}
      style={({ pressed }) => ({ width: box, height: box, borderRadius: primary ? 16 : box / 2, overflow: ios ? undefined : 'hidden', alignItems: 'center', justifyContent: 'center', backgroundColor: primary ? c.accent : undefined, opacity: pressedOpacity(pressed, control.dim ? 0.4 : 1) })}
    >
      <Glyph name={control.pause ? 'pause' : 'play'} size={glyph} colour={primary ? c.onAccent : c.ink} />
    </Pressable>
  );
}

/** On iOS every mini player sits on glass, so its words take the system's label colours. */
function Titles({ release, note, single = false }: { release: PlayableRelease; note: string | null; single?: boolean }) {
  const { c } = useTokens();
  const player = usePlayer();
  const sub = { fontSize: ios ? 13 : 12, lineHeight: ios ? 17 : 16, color: ON_GLASS?.sub ?? c.sub };
  return (
    <View style={{ flex: 1, minWidth: 0, justifyContent: 'center' }}>
      {single && note !== null ? (
        <Text numberOfLines={1} style={sub}>{note}</Text>
      ) : (
        <Text numberOfLines={1} style={{ fontSize: ios ? 15 : 14, lineHeight: 20, fontWeight: ios ? '600' : '500', color: ON_GLASS?.ink ?? c.ink }}>
          {trackLine(player, release)}
        </Text>
      )}
      {single ? null : (
        <Text numberOfLines={1} style={sub}>
          {note ?? release.artist}
        </Text>
      )}
    </View>
  );
}

function Contents({ release, inline = false }: { release: PlayableRelease; inline?: boolean }) {
  const { c } = useTokens();
  const note = playerNote(usePlayer());
  const art = ios ? (inline ? 26 : 34) : 48;
  const open = () => router.push('/player');
  const label = playerCopy.open(release.title, note);
  return (
    <Pressable
      onPress={open}
      accessible={!ios}
      accessibilityRole={ios ? undefined : 'button'}
      accessibilityLabel={ios ? undefined : label}
      android_ripple={ripple(c.track)}
      style={({ pressed }) => ({ flex: 1, flexDirection: 'row', alignItems: 'center', gap: ios ? 10 : 12, paddingLeft: ios ? (inline ? 6 : 10) : 8, paddingRight: ios ? 4 : 8, borderRadius: ios ? undefined : CAPSULE / 2, overflow: ios ? undefined : 'hidden', opacity: pressedOpacity(pressed) })}
    >
      <View
        accessible={ios}
        accessibilityRole={ios ? 'button' : undefined}
        accessibilityLabel={ios ? label : undefined}
        onAccessibilityTap={ios ? open : undefined}
        style={{ flex: 1, minWidth: 0, alignSelf: 'stretch', flexDirection: 'row', alignItems: 'center', gap: ios ? 10 : 12 }}
      >
        <Artwork hue={release.hue} url={release.artUrl} size={art} radius={ios ? (inline ? 5 : 6) : art / 2} />
        <Titles release={release} note={note} single={inline} />
      </View>
      {ios ? <PlayPause box={inline ? 36 : 44} glyph={inline ? 18 : 21} /> : <PlayPause box={48} glyph={24} primary />}
    </Pressable>
  );
}

/** Laid out as `Contents` lays out the accessory, so the restore or a first play swaps only what the slots hold. */
function NothingPlaying({ inline }: { inline: boolean }) {
  const { c } = useTokens();
  const art = inline ? 26 : 34;
  const box = inline ? 36 : 44;
  return (
    <View
      accessible
      accessibilityLabel={copy.player.nothingPlaying}
      style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, paddingLeft: inline ? 6 : 10, paddingRight: 4 }}
    >
      <View style={{ width: art, height: art, borderRadius: inline ? 5 : 6, backgroundColor: c.track }} />
      <Text numberOfLines={1} style={{ flex: 1, minWidth: 0, fontSize: inline ? 13 : 15, lineHeight: inline ? 17 : 20, color: ON_GLASS?.sub ?? c.sub }}>
        {copy.player.nothingPlaying}
      </Text>
      <View style={{ width: box, height: box, alignItems: 'center', justifyContent: 'center', opacity: 0.4 }}>
        <Glyph name="play" size={inline ? 18 : 21} colour={c.ink} />
      </View>
    </View>
  );
}

export function AccessoryPlayer() {
  const placement = NativeTabs.BottomAccessory.usePlacement();
  const current = usePlayerRelease();
  const inline = placement === 'inline';
  return current ? <Contents release={current} inline={inline} /> : <NothingPlaying inline={inline} />;
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

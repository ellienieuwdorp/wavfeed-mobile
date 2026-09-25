/**
 * The mini player (DESIGN-UI section 10, task 0036 decision 5, the v2 client canvas): artwork, "N. Track title" over
 * the Page, play or pause, the heart for the playing Track. On iOS 26 it is the tab bar's bottom accessory, whose glass
 * the system draws; without it, a GlassView capsule of its own; on Android a raised floating toolbar. It opens the
 * player sheet, and it is absent until the first play.
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import { router } from 'expo-router';
import { NativeTabs } from 'expo-router/unstable-native-tabs';
import { Platform, Pressable, Text, View } from 'react-native';

import { Artwork } from '@/components/Artwork';
import { Heart } from '@/components/Heart';
import { playerCopy } from '@/player/copy';
import { useTokens } from '@/theme/tokens';

import { usePlayer, type Player, type PlayableRelease } from './playerState';

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

function PlayPause({ size, primary = false }: { size: number; primary?: boolean }) {
  const { c } = useTokens();
  const { playing, toggle, status } = usePlayer();
  const enabled = status === 'ready';
  return (
    <Pressable
      onPress={toggle}
      disabled={!enabled}
      accessibilityRole="button"
      accessibilityLabel={playing ? playerCopy.pause : playerCopy.play}
      accessibilityState={{ disabled: !enabled }}
      style={{ width: size, height: size, borderRadius: primary ? 16 : size / 2, alignItems: 'center', justifyContent: 'center', backgroundColor: primary ? c.accent : undefined, opacity: enabled ? 1 : 0.4 }}
    >
      <Ionicons name={playing ? 'pause' : 'play'} size={primary ? 24 : 22} color={primary ? c.onAccent : c.ink} />
    </Pressable>
  );
}

function Titles({ release }: { release: PlayableRelease }) {
  const { c } = useTokens();
  const player = usePlayer();
  const note = playerNote(player);
  return (
    <View style={{ flex: 1, minWidth: 0 }}>
      <Text numberOfLines={1} style={{ fontSize: 14, fontWeight: ios ? '600' : '500', color: c.ink }}>{trackLine(player, release)}</Text>
      <Text numberOfLines={1} style={{ fontSize: 12, color: c.sub }}>{note ?? release.artist}</Text>
    </View>
  );
}

function TrackHeart({ release, box, icon }: { release: PlayableRelease; box: number; icon: number }) {
  const { track, status } = usePlayer();
  if (track === null || status !== 'ready') return <View style={{ width: box, height: box }} />;
  return <Heart itemType={release.itemType} itemId={release.itemId} trackId={track.trackId} title={track.title} box={box} icon={icon} />;
}

function Contents({ release, compact = false }: { release: PlayableRelease; compact?: boolean }) {
  const art = compact ? 28 : ios ? 40 : 48;
  return (
    <Pressable
      onPress={() => router.push('/player')}
      accessibilityRole="button"
      accessibilityLabel={playerCopy.open(release.title)}
      style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: ios ? 10 : 12, paddingHorizontal: compact ? 6 : 8 }}
    >
      <Artwork hue={release.hue} url={release.artUrl} size={art} radius={art / 2} />
      <Titles release={release} />
      {ios ? (
        <>
          <PlayPause size={40} />
          {compact ? null : <TrackHeart release={release} box={44} icon={22} />}
        </>
      ) : (
        <>
          <TrackHeart release={release} box={48} icon={24} />
          <PlayPause size={48} primary />
        </>
      )}
    </Pressable>
  );
}

export function AccessoryPlayer() {
  const placement = NativeTabs.BottomAccessory.usePlacement();
  const { current } = usePlayer();
  return current ? <Contents release={current} compact={placement === 'inline'} /> : null;
}

export function MiniPlayer() {
  const { c } = useTokens();
  const { current } = usePlayer();
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
    <View style={[shape, { backgroundColor: c.surface, boxShadow: '0 4px 16px rgba(0,0,0,0.16)' }]}>
      <Contents release={current} />
    </View>
  );
}

/**
 * The mini player (task 0036 decision 5, the v2 client canvas): artwork, "N.
 * Title" over the Page, play or pause, the heart. On iOS 26 it is the tab bar's
 * bottom accessory, whose glass the system draws; without it, a GlassView capsule
 * of its own; on Android a raised floating toolbar. It opens the player sheet.
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import { router } from 'expo-router';
import { NativeTabs } from 'expo-router/unstable-native-tabs';
import { Platform, Pressable, Text, View } from 'react-native';

import { Artwork } from '@/components/Artwork';
import { Heart } from '@/components/Heart';
import { copy } from '@/copy';
import { useTokens } from '@/theme/tokens';

import { usePlayer, type Track } from './playerState';

const ios = Platform.OS === 'ios';

export const CAPSULE = ios ? 56 : 64;

export function playerInAccessory(): boolean {
  return ios && isLiquidGlassAvailable();
}

function PlayPause({ size, primary = false }: { size: number; primary?: boolean }) {
  const { c } = useTokens();
  const { playing, toggle } = usePlayer();
  return (
    <Pressable
      onPress={toggle}
      accessibilityRole="button"
      accessibilityLabel={playing ? copy.player.pause : copy.player.play}
      style={{ width: size, height: size, borderRadius: primary ? 16 : size / 2, alignItems: 'center', justifyContent: 'center', backgroundColor: primary ? c.accent : undefined }}
    >
      <Ionicons name={playing ? 'pause' : 'play'} size={primary ? 24 : 22} color={primary ? c.onAccent : c.ink} />
    </Pressable>
  );
}

function Titles({ track }: { track: Track }) {
  const { c } = useTokens();
  return (
    <View style={{ flex: 1, minWidth: 0 }}>
      <Text numberOfLines={1} style={{ fontSize: 14, fontWeight: ios ? '600' : '500', color: c.ink }}>{copy.player.trackTitle(track.n, track.title)}</Text>
      <Text numberOfLines={1} style={{ fontSize: 12, color: c.sub }}>{track.artist}</Text>
    </View>
  );
}

function Contents({ track, compact = false }: { track: Track; compact?: boolean }) {
  const art = compact ? 28 : ios ? 40 : 48;
  return (
    <Pressable
      onPress={() => router.push('/player')}
      accessibilityRole="button"
      accessibilityLabel={copy.player.open(track.title)}
      style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: ios ? 10 : 12, paddingHorizontal: compact ? 6 : 8 }}
    >
      <Artwork hue={track.hue} size={art} radius={art / 2} />
      <Titles track={track} />
      {ios ? (
        <>
          <PlayPause size={40} />
          {compact ? null : <Heart title={track.title} initial={track.on} box={40} icon={22} />}
        </>
      ) : (
        <>
          <Heart title={track.title} initial={track.on} box={48} icon={24} />
          <PlayPause size={48} primary />
        </>
      )}
    </Pressable>
  );
}

export function AccessoryPlayer() {
  const placement = NativeTabs.BottomAccessory.usePlacement();
  const { current } = usePlayer();
  return current ? <Contents track={current} compact={placement === 'inline'} /> : null;
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
        <Contents track={current} />
      </GlassView>
    );
  }
  return (
    <View style={[shape, { backgroundColor: c.surface, boxShadow: '0 4px 16px rgba(0,0,0,0.16)' }]}>
      <Contents track={current} />
    </View>
  );
}

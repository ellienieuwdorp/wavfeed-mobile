/**
 * The player sheet (DESIGN-UI section 10, ADR-0015, the v2 client canvas's player sheets): artwork, "N. Track title"
 * linking out with the Page and Release under it, the seek slider with its m:ss times, the transport, the heart for the
 * playing Track and "Buy on Bandcamp ↗". An unplayable Release or a failed load puts its note where the slider sits.
 * At the medium detent the artwork steps aside so the controls show.
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import Slider from '@react-native-community/slider';
import { openURL } from 'expo-linking';
import { useNavigation } from 'expo-router';
import type { NativeStackNavigationProp } from 'expo-router/native-stack';
import type { ParamListBase } from 'expo-router/react-navigation';
import { useEffect, useState } from 'react';
import { Platform, Pressable, Text, View, useWindowDimensions } from 'react-native';

import { Artwork } from '@/components/Artwork';
import { Heart } from '@/components/Heart';
import { playerNote, trackLine } from '@/components/player/MiniPlayer';
import { clock, usePlayer, usePlayerClock, type PlayableRelease } from '@/components/player/playerState';
import { sep } from '@/copy';
import { playerCopy } from '@/player/copy';
import { useTokens } from '@/theme/tokens';

const ios = Platform.OS === 'ios';

function open(release: PlayableRelease) {
  openURL(release.url).catch(() => undefined);
}

function Times({ at, total }: { at: number; total: number }) {
  const { c } = useTokens();
  const style = { fontSize: 12, color: c.sub, fontVariant: ['tabular-nums' as const] };
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
      <Text style={style}>{clock(at)}</Text>
      <Text style={style}>{clock(total)}</Text>
    </View>
  );
}

function SeekLine() {
  const { c } = useTokens();
  const { track, status, seek } = usePlayer();
  const { position, duration } = usePlayerClock();
  const [drag, setDrag] = useState<number | null>(null);
  const live = status === 'ready' && track !== null;
  const shown = drag ?? Math.min(position, duration || position);
  return (
    <View style={{ gap: ios ? 2 : 6 }}>
      <Slider
        value={live ? shown : 0}
        minimumValue={0}
        maximumValue={Math.max(duration, 1)}
        disabled={!live}
        onSlidingStart={setDrag}
        onValueChange={(v) => setDrag((d) => (d === null ? d : v))}
        onSlidingComplete={(v) => {
          seek(v);
          setDrag(null);
        }}
        minimumTrackTintColor={ios ? c.ink : c.accent}
        maximumTrackTintColor={c.border}
        thumbTintColor={ios ? undefined : c.accent}
        accessibilityLabel={track === null ? undefined : playerCopy.seek(track.title)}
        style={{ height: 44 }}
      />
      <Times at={live ? shown : 0} total={live ? duration : 0} />
    </View>
  );
}

function Note({ text }: { text: string }) {
  const { c } = useTokens();
  return (
    <View style={{ minHeight: 44 + 20, justifyContent: 'center' }}>
      <Text accessibilityLiveRegion="polite" style={{ fontSize: 15, color: c.sub, textAlign: 'center' }}>{text}</Text>
    </View>
  );
}

function Skip({ name, label, onPress, enabled }: { name: 'play-back' | 'play-forward'; label: string; onPress: () => void; enabled: boolean }) {
  const { c } = useTokens();
  return (
    <Pressable
      onPress={onPress}
      disabled={!enabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !enabled }}
      style={{ width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center', opacity: enabled ? 1 : 0.3 }}
    >
      <Ionicons name={name} size={ios ? 34 : 30} color={c.ink} />
    </Pressable>
  );
}

function Transport() {
  const { c } = useTokens();
  const { playing, toggle, next, previous, canNext, canPrevious, status } = usePlayer();
  const ready = status === 'ready';
  const main = ios ? 64 : 80;
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: ios ? 28 : 20 }}>
      <Skip name="play-back" label={playerCopy.previous} onPress={previous} enabled={ready && canPrevious} />
      <Pressable
        onPress={toggle}
        disabled={!ready}
        accessibilityRole="button"
        accessibilityLabel={playing ? playerCopy.pause : playerCopy.play}
        accessibilityState={{ disabled: !ready }}
        style={{ width: main, height: main, borderRadius: 28, alignItems: 'center', justifyContent: 'center', backgroundColor: ios ? undefined : c.accent, opacity: ready ? 1 : 0.4 }}
      >
        <Ionicons name={playing ? 'pause' : 'play'} size={ios ? 48 : 36} color={ios ? c.ink : c.onAccent} />
      </Pressable>
      <Skip name="play-forward" label={playerCopy.next} onPress={next} enabled={ready && canNext} />
    </View>
  );
}

export default function PlayerSheet() {
  const { c } = useTokens();
  const { width } = useWindowDimensions();
  const player = usePlayer();
  const { current, track, status } = player;
  const navigation = useNavigation<NativeStackNavigationProp<ParamListBase>>();
  const [full, setFull] = useState(true);

  useEffect(() => navigation.addListener('sheetDetentChange', (e) => setFull(e.data.index > 0)), [navigation]);

  if (!current) return null;
  const note = playerNote(player);
  const heartBox = ios ? 44 : 48;
  return (
    <View style={{ paddingHorizontal: 24, paddingTop: ios ? 28 : 16, paddingBottom: 40, gap: 18, backgroundColor: c.surface }}>
      {full ? (
        <View style={{ borderRadius: ios ? 14 : 24, boxShadow: '0 16px 40px rgba(0,0,0,0.25)' }}>
          <Artwork hue={current.hue} url={current.artUrl} size={width - 48} radius={ios ? 14 : 24} />
        </View>
      ) : null}
      <Pressable onPress={() => open(current)} accessibilityRole="link" accessibilityLabel={playerCopy.openOnBandcamp(track?.title ?? current.title)}>
        <Text numberOfLines={2} style={{ fontSize: ios ? 20 : 22, fontWeight: ios ? '700' : '500', color: c.ink }}>
          {trackLine(player, current)}
          <Text style={{ fontSize: 16, color: c.accent }}>{' ↗'}</Text>
        </Text>
        <Text numberOfLines={1} style={{ fontSize: 16, color: c.sub }}>{current.artist + sep + current.title}</Text>
      </Pressable>
      {note === null ? <SeekLine key={track?.trackId ?? 'none'} /> : <Note text={note} />}
      <Transport />
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        {track !== null && status === 'ready' ? (
          <Heart itemType={current.itemType} itemId={current.itemId} trackId={track.trackId} title={track.title} box={heartBox} icon={26} />
        ) : (
          <View style={{ width: heartBox, height: heartBox }} />
        )}
        <Pressable
          onPress={() => open(current)}
          accessibilityRole="link"
          accessibilityLabel={playerCopy.buyLabel}
          style={ios ? { minHeight: 44, justifyContent: 'center' } : { minHeight: 48, justifyContent: 'center', paddingHorizontal: 22, borderRadius: 24, backgroundColor: c.tint }}
        >
          <Text style={{ fontSize: ios ? 16 : 15, fontWeight: ios ? '400' : '500', color: ios ? c.accent : c.ink }}>{playerCopy.buy}</Text>
        </Pressable>
      </View>
    </View>
  );
}

/**
 * The player sheet (DESIGN-UI section 10, the v2 client canvas's player sheets):
 * artwork, "N. Title" linking out with the Release under it, the seek line with
 * its times, the transport, the heart for the playing Track and "Buy on Bandcamp
 * ↗". At the medium detent the artwork steps aside so the controls show.
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { useNavigation } from 'expo-router';
import type { NativeStackNavigationProp } from 'expo-router/native-stack';
import type { ParamListBase } from 'expo-router/react-navigation';
import { useEffect, useState } from 'react';
import { Linking, Platform, Pressable, Text, View, useWindowDimensions } from 'react-native';

import { Artwork } from '@/components/Artwork';
import { Heart } from '@/components/Heart';
import { clock, usePlayer, type Track } from '@/components/player/playerState';
import { copy, sep } from '@/copy';
import { useTokens } from '@/theme/tokens';

const ios = Platform.OS === 'ios';

function open(track: Track) {
  if (track.url) void Linking.openURL(track.url);
}

function Seek({ at }: { at: number }) {
  const { c } = useTokens();
  const pct = `${Math.round(at * 100)}%` as const;
  if (ios) {
    return (
      <View style={{ height: 16, justifyContent: 'center' }}>
        <View style={{ height: 6, borderRadius: 3, backgroundColor: c.border }}>
          <View style={{ width: pct, height: 6, borderRadius: 3, backgroundColor: c.ink }} />
        </View>
        <View style={{ position: 'absolute', left: pct, marginLeft: -8, width: 16, height: 16, borderRadius: 8, backgroundColor: c.ink }} />
      </View>
    );
  }
  return (
    <View style={{ height: 44, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <View style={{ width: pct, height: 16, borderTopLeftRadius: 8, borderBottomLeftRadius: 8, borderTopRightRadius: 2, borderBottomRightRadius: 2, backgroundColor: c.accent }} />
      <View style={{ width: 4, height: 44, borderRadius: 2, backgroundColor: c.accent }} />
      <View style={{ flex: 1, height: 16, borderTopRightRadius: 8, borderBottomRightRadius: 8, borderTopLeftRadius: 2, borderBottomLeftRadius: 2, backgroundColor: c.tint }} />
    </View>
  );
}

function Transport() {
  const { c } = useTokens();
  const { playing, toggle } = usePlayer();
  const side = 56;
  const main = ios ? 64 : 80;
  const skip = (name: 'play-back' | 'play-forward', label: string) => (
    <Pressable accessibilityRole="button" accessibilityLabel={label} style={{ width: side, height: side, borderRadius: 28, alignItems: 'center', justifyContent: 'center' }}>
      <Ionicons name={name} size={ios ? 34 : 30} color={c.ink} />
    </Pressable>
  );
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: ios ? 28 : 20 }}>
      {skip('play-back', copy.player.previous)}
      <Pressable
        onPress={toggle}
        accessibilityRole="button"
        accessibilityLabel={playing ? copy.player.pause : copy.player.play}
        style={{ width: main, height: main, borderRadius: 28, alignItems: 'center', justifyContent: 'center', backgroundColor: ios ? undefined : c.accent }}
      >
        <Ionicons name={playing ? 'pause' : 'play'} size={ios ? 48 : 36} color={ios ? c.ink : c.onAccent} />
      </Pressable>
      {skip('play-forward', copy.player.next)}
    </View>
  );
}

export default function PlayerSheet() {
  const { c } = useTokens();
  const { width } = useWindowDimensions();
  const { current, position } = usePlayer();
  const navigation = useNavigation<NativeStackNavigationProp<ParamListBase>>();
  const [full, setFull] = useState(true);

  useEffect(() => navigation.addListener('sheetDetentChange', (e) => setFull(e.data.index > 0)), [navigation]);

  if (!current) return null;
  const at = current.duration ? position / current.duration : 0;
  return (
    <View style={{ paddingHorizontal: 24, paddingTop: ios ? 28 : 16, paddingBottom: 40, gap: 18, backgroundColor: c.surface }}>
      {full ? (
        <View style={{ borderRadius: ios ? 14 : 24, boxShadow: '0 16px 40px rgba(0,0,0,0.25)' }}>
          <Artwork hue={current.hue} size={width - 48} radius={ios ? 14 : 24} />
        </View>
      ) : null}
      <Pressable onPress={() => open(current)} disabled={!current.url} accessibilityRole="link" accessibilityLabel={copy.player.openOnBandcamp(current.title)}>
        <Text style={{ fontSize: ios ? 20 : 22, fontWeight: ios ? '700' : '500', color: c.ink }}>
          {copy.player.trackTitle(current.n, current.title)}
          <Text style={{ fontSize: 16, color: c.accent }}>{' ↗'}</Text>
        </Text>
        <Text numberOfLines={1} style={{ fontSize: 16, color: c.sub }}>{current.artist + sep + current.release}</Text>
      </Pressable>
      <View style={{ gap: 6 }}>
        <Seek at={at} />
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <Text style={{ fontSize: 12, color: c.sub, fontVariant: ['tabular-nums'] }}>{clock(position)}</Text>
          <Text style={{ fontSize: 12, color: c.sub, fontVariant: ['tabular-nums'] }}>{clock(current.duration)}</Text>
        </View>
      </View>
      <Transport />
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Heart title={current.title} initial={current.on} box={ios ? 44 : 48} icon={26} />
        <Pressable
          onPress={() => open(current)}
          disabled={!current.url}
          accessibilityRole="link"
          accessibilityLabel={copy.player.buyLabel}
          style={ios ? { minHeight: 44, justifyContent: 'center' } : { minHeight: 48, justifyContent: 'center', paddingHorizontal: 22, borderRadius: 24, backgroundColor: c.tint }}
        >
          <Text style={{ fontSize: ios ? 16 : 15, fontWeight: ios ? '400' : '500', color: ios ? c.accent : c.ink }}>{copy.player.buy}</Text>
        </Pressable>
      </View>
    </View>
  );
}

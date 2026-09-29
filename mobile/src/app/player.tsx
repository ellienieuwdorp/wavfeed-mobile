/**
 * The player sheet (DESIGN-UI section 10, ADR-0015, task 0036 decision 5, the v2 client canvas's player sheets), one
 * scroll in Apple Music's shape: artwork, "N. Track title" linking out, the Page and Release, the label and release day,
 * the seek line with its m:ss times, the transport, the heart for the playing Track and "Buy on Bandcamp ↗", then the
 * Release's tracklist. On iOS it is a page sheet with its grabber and close chevron over a plain face, so the pull-down
 * dismisses from the art and from the top of the scroll; on Android a bottom sheet with 28dp corners at full height,
 * Compose's Material 3 slider and the ripple on every control. Every block above the tracklist has a fixed height, so
 * nothing moves when a Track changes.
 */
import { fillMaxWidth } from '@expo/ui/jetpack-compose/modifiers';
import { Host as ComposeHost, Slider as ComposeSlider } from '@expo/ui/jetpack-compose';
import Slider from '@react-native-community/slider';
import { openURL } from 'expo-linking';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Artwork } from '@/components/Artwork';
import { Glyph, type GlyphName } from '@/components/Glyph';
import { isDead, playerNote, showsPause, trackLine, TrackHeart } from '@/components/player/MiniPlayer';
import { clock, usePlayer, usePlayerClock, usePlayerRelease, type PlayableRelease } from '@/components/player/playerState';
import { Tracklist } from '@/components/player/Tracklist';
import { SELF_RELEASED, sep } from '@/copy';
import { SAMPLE_MODE } from '@/dev/sampleMode';
import { useSampleStart } from '@/dev/useSampleData';
import { formatDatePart, releaseDay } from '@/lib/dates';
import { playerCopy } from '@/player/copy';
import { pressedOpacity, ripple, useTokens } from '@/theme/tokens';

const ios = Platform.OS === 'ios';

const SIDE = 24;
const GAP = 18;
const HEAD = ios ? 52 : 48;
const TITLE = ios ? 25 : 28;
const SUBTITLE = 21;
const FACTS = 18;
const SEEK = 62;
const MAIN = ios ? 72 : 80;
const ACTIONS = ios ? 44 : 48;
const ART_RADIUS = ios ? 14 : 24;
/** Where Material's full-height sheet stops below the status bar. */
const SHEET_TOP = 24;

function open(release: PlayableRelease) {
  openURL(release.url).catch(() => undefined);
}

/** The label, "self-released" when the row knew there was none, and the release day, each only when the row held it. */
function factsLine(release: PlayableRelease): string {
  const parts: string[] = [];
  if (release.label !== undefined) parts.push(release.label ?? SELF_RELEASED);
  const day = release.releaseDate ? releaseDay(release.releaseDate) : null;
  if (day !== null && !Number.isNaN(day.getTime())) parts.push(formatDatePart(day, { year: true }));
  return parts.join(sep);
}

function Head() {
  const { c } = useTokens();
  if (!ios) {
    return (
      <Pressable
        onPress={() => router.back()}
        accessibilityRole="button"
        accessibilityLabel={playerCopy.close}
        style={{ height: HEAD, alignItems: 'center', justifyContent: 'center' }}
      >
        <View style={{ width: 32, height: 4, borderRadius: 2, backgroundColor: c.faint, opacity: 0.4 }} />
      </Pressable>
    );
  }
  return (
    <View style={{ height: HEAD, paddingHorizontal: SIDE, justifyContent: 'flex-end' }}>
      <View style={{ position: 'absolute', top: 6, alignSelf: 'center', width: 36, height: 5, borderRadius: 3, backgroundColor: c.border }} />
      <Pressable
        onPress={() => router.back()}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={playerCopy.close}
        style={({ pressed }) => ({ width: 44, height: 44, marginLeft: -10, alignItems: 'center', justifyContent: 'center', opacity: pressedOpacity(pressed) })}
      >
        <Glyph name="close" size={22} colour={c.sub} />
      </Pressable>
    </View>
  );
}

function Times({ at, total }: { at: number; total: number }) {
  const { c } = useTokens();
  const style = { fontSize: 12, lineHeight: 16, color: c.sub, fontVariant: ['tabular-nums' as const] };
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
      <Text style={style}>{clock(at)}</Text>
      <Text style={style}>{clock(total)}</Text>
    </View>
  );
}

const SEEK_STEP_S = 5;

type SeekProps = { value: number; max: number; live: boolean; label: string; onDrag: (v: number) => void; onDone: () => void; onStep: (v: number) => void };

/**
 * Android's seek line: Compose's Material 3 slider, which draws Expressive's tall handle with the gap on each side. The
 * Compose slider takes no accessible name, so TalkBack meets a labelled adjustable View over it, stepping five seconds.
 */
function MaterialSeek({ value, max, live, label, onDrag, onDone, onStep }: SeekProps) {
  const { c, dark } = useTokens();
  return (
    <View
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !live }}
      accessibilityValue={{ min: 0, max: Math.round(max), now: Math.round(value), text: clock(value) }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={(e) => {
        if (!live) return;
        const step = e.nativeEvent.actionName === 'increment' ? SEEK_STEP_S : -SEEK_STEP_S;
        onStep(Math.min(max, Math.max(0, value + step)));
      }}
    >
      <ComposeHost colorScheme={dark ? 'dark' : 'light'} seedColor={c.accent} style={{ height: 44 }}>
        <ComposeSlider
          value={value}
          min={0}
          max={max}
          enabled={live}
          onValueChange={onDrag}
          onValueChangeFinished={onDone}
          colors={{ thumbColor: c.accent, activeTrackColor: c.accent, inactiveTrackColor: c.tint }}
          modifiers={[fillMaxWidth()]}
        />
      </ComposeHost>
    </View>
  );
}

function SeekLine() {
  const { c } = useTokens();
  const { track, status, seek } = usePlayer();
  const { position, duration } = usePlayerClock();
  const [drag, setDrag] = useState<number | null>(null);
  const dragged = useRef<number | null>(null);
  /** The value the native slider is fed while a drag is on: held still, so the thumb follows the finger and nothing else. */
  const anchor = useRef(0);
  const live = status === 'ready' && track !== null;
  const shown = drag ?? Math.min(position, duration || position);
  const fed = drag === null ? shown : anchor.current;
  if (!ios) {
    return (
      <View style={{ height: SEEK, justifyContent: 'center', gap: 2 }}>
        <MaterialSeek
          value={live ? shown : 0}
          max={Math.max(duration, 1)}
          live={live}
          label={track === null ? playerCopy.seekIdle : playerCopy.seek(track.title)}
          onStep={seek}
          onDrag={(v) => {
            dragged.current = v;
            setDrag(v);
          }}
          onDone={() => {
            if (dragged.current !== null) seek(dragged.current);
            dragged.current = null;
            setDrag(null);
          }}
        />
        <Times at={live ? shown : 0} total={live ? duration : 0} />
      </View>
    );
  }
  return (
    <View style={{ height: SEEK, justifyContent: 'center', gap: 2 }}>
      <Slider
        value={live ? fed : 0}
        minimumValue={0}
        maximumValue={Math.max(duration, 1)}
        disabled={!live}
        onSlidingStart={(v) => {
          anchor.current = v;
          setDrag(v);
        }}
        onValueChange={(v) => setDrag((d) => (d === null ? d : v))}
        onSlidingComplete={(v) => {
          seek(v);
          setDrag(null);
        }}
        minimumTrackTintColor={c.ink}
        maximumTrackTintColor={c.border}
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
    <View style={{ height: SEEK, justifyContent: 'center' }}>
      <Text accessibilityLiveRegion="polite" numberOfLines={2} style={{ fontSize: 15, color: c.sub, textAlign: 'center' }}>{text}</Text>
    </View>
  );
}

function Skip({ name, label, onPress, enabled }: { name: GlyphName; label: string; onPress: () => void; enabled: boolean }) {
  const { c } = useTokens();
  return (
    <Pressable
      onPress={onPress}
      disabled={!enabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !enabled }}
      android_ripple={ripple(c.track, 28)}
      style={({ pressed }) => ({ width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center', opacity: pressedOpacity(pressed, enabled ? 1 : 0.3) })}
    >
      <Glyph name={name} size={ios ? 34 : 30} colour={c.ink} />
    </Pressable>
  );
}

function Transport() {
  const { c } = useTokens();
  const player = usePlayer();
  const { toggle, next, previous, canNext, canPrevious, status } = player;
  const ready = status === 'ready';
  const pause = showsPause(player);
  return (
    <View style={{ height: MAIN, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: ios ? 36 : 20 }}>
      <Skip name="previous" label={playerCopy.previous} onPress={previous} enabled={ready && canPrevious} />
      <Pressable
        onPress={toggle}
        disabled={!ready}
        accessibilityRole="button"
        accessibilityLabel={pause ? playerCopy.pause : playerCopy.play}
        accessibilityState={{ disabled: !ready }}
        android_ripple={ripple(c.onAccent)}
        style={({ pressed }) => ({ width: MAIN, height: MAIN, borderRadius: 28, overflow: ios ? undefined : 'hidden', alignItems: 'center', justifyContent: 'center', backgroundColor: ios ? undefined : c.accent, opacity: pressedOpacity(pressed, isDead(player) ? 0.4 : 1) })}
      >
        <Glyph name={pause ? 'pause' : 'play'} size={ios ? 48 : 36} colour={ios ? c.ink : c.onAccent} />
      </Pressable>
      <Skip name="next" label={playerCopy.next} onPress={next} enabled={ready && canNext} />
    </View>
  );
}

function Titles({ release }: { release: PlayableRelease }) {
  const { c } = useTokens();
  const player = usePlayer();
  const title = trackLine(player, release);
  return (
    <View>
      <Pressable onPress={() => open(release)} accessibilityRole="link" accessibilityLabel={playerCopy.openOnBandcamp(player.track?.title ?? release.title)} android_ripple={ripple(c.track)} style={({ pressed }) => ({ opacity: pressedOpacity(pressed) })}>
        <View style={{ height: TITLE, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Text numberOfLines={1} style={{ flexShrink: 1, fontSize: ios ? 20 : 22, lineHeight: TITLE, fontWeight: ios ? '700' : '500', color: c.ink }}>{title}</Text>
          <Text style={{ fontSize: 16, color: c.accent }}>{playerCopy.linkOut}</Text>
        </View>
        <Text numberOfLines={1} style={{ height: SUBTITLE, fontSize: 16, lineHeight: SUBTITLE, color: c.sub }}>{release.artist + sep + release.title}</Text>
      </Pressable>
      <Text numberOfLines={1} style={{ height: FACTS, marginTop: 4, fontSize: 13, lineHeight: FACTS, color: c.faint }}>{factsLine(release)}</Text>
    </View>
  );
}

function Actions({ release }: { release: PlayableRelease }) {
  const { c } = useTokens();
  return (
    <View style={{ height: ACTIONS, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginHorizontal: ios ? -8 : 0 }}>
      <TrackHeart release={release} box={ACTIONS} icon={26} />
      <Pressable
        onPress={() => open(release)}
        accessibilityRole="link"
        accessibilityLabel={playerCopy.buyLabel}
        android_ripple={ripple(c.track)}
        style={({ pressed }) => (ios ? { minHeight: 44, paddingHorizontal: 8, justifyContent: 'center', opacity: pressedOpacity(pressed) } : { minHeight: 48, justifyContent: 'center', paddingHorizontal: 22, borderRadius: 24, overflow: 'hidden', backgroundColor: c.tint })}
      >
        <Text style={{ fontSize: ios ? 16 : 15, fontWeight: ios ? '400' : '500', color: ios ? c.accent : c.ink }}>{playerCopy.buy}</Text>
      </Pressable>
    </View>
  );
}

export default function PlayerSheet() {
  const { c } = useTokens();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const current = usePlayerRelease();
  const player = usePlayer();
  const { sample } = useLocalSearchParams<{ sample?: string }>();
  const starting = SAMPLE_MODE && sample !== undefined;
  useSampleStart(starting);
  // A deep link or a stale history entry with nothing playing closes the sheet, so it never stands empty.
  useEffect(() => {
    if (!current && !starting && router.canGoBack()) router.back();
  }, [current, starting]);
  if (!current) {
    return (
      <View style={{ flex: ios ? 1 : undefined, backgroundColor: c.surface }}>
        <Head />
      </View>
    );
  }
  const art = Math.round(width - SIDE * 2);
  const note = playerNote(player);
  return (
    <View
      onAccessibilityEscape={() => router.back()}
      style={ios ? { flex: 1, backgroundColor: c.surface } : { height: height - insets.top - SHEET_TOP, backgroundColor: c.surface }}
    >
      <Head />
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        nestedScrollEnabled
        showsVerticalScrollIndicator={false}
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: SIDE, paddingTop: ios ? 4 : 8, paddingBottom: (ios ? 0 : insets.bottom) + 32, gap: GAP }}
      >
        <View style={{ alignSelf: 'center', width: art, height: art, borderRadius: ART_RADIUS, backgroundColor: c.surface, boxShadow: '0 16px 40px rgba(0,0,0,0.25)' }}>
          <Artwork hue={current.hue} url={current.artUrl} size={art} radius={ART_RADIUS} />
        </View>
        <Titles release={current} />
        {note === null ? <SeekLine key={player.track?.trackId ?? 'none'} /> : <Note text={note} />}
        <Transport />
        <Actions release={current} />
        <Tracklist release={current} side={SIDE} />
      </ScrollView>
    </View>
  );
}

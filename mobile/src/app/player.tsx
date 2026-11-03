/**
 * The player sheet (DESIGN-UI section 10, ADR-0015, the v2 client canvas's player sheets), one
 * scroll in Apple Music's shape: artwork with the Release's heart on its bottom-right corner, "N. Track title" linking
 * out over the Page and Release, the label and release day ending in "Bandcamp ↗", the seek line with its m:ss times,
 * the transport, then the Release's tracklist, a heart on each Track. The facts line's link names where the title also goes, and the art gives up width only so the tracklist's first row shows when the sheet opens (artSide). On iOS it is a page sheet with its
 * grabber and close chevron over a plain face, so the pull-down dismisses from the art and from the top of the scroll;
 * on Android a bottom sheet with 28dp corners at full height, Compose's Material 3 slider and the ripple on every
 * control. Every block above the tracklist keeps one height for a given text size, its text one line and its height at
 * least the default's, so nothing moves when a Track changes; the seek block holds one height at every size, its m:ss
 * times not growing and the note standing in for it fitting two lines (review VIS-1).
 */
import { fillMaxWidth } from '@expo/ui/jetpack-compose/modifiers';
import { Host as ComposeHost, Slider as ComposeSlider } from '@expo/ui/jetpack-compose';
import Slider from '@react-native-community/slider';
import { openURL } from 'expo-linking';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Artwork } from '@/components/Artwork';
import { Glyph, type GlyphName } from '@/components/Glyph';
import { Heart } from '@/components/Heart';
import { trackLine, usePlayControl } from '@/components/player/MiniPlayer';
import { clock, usePlayer, usePlayerActions, usePlayerClock, usePlayerRelease } from '@/components/player/playerState';
import { ROW, Tracklist, TRACKS_HEAD_LINE, TRACKS_HEAD_PAD } from '@/components/player/Tracklist';
import { Type } from '@/components/Type';
import { SELF_RELEASED, sep, sheetSubtitle } from '@/copy';
import { sampleRig } from '@/dev/rig';
import { SAMPLE_MODE } from '@/dev/sampleMode';
import { formatDatePart } from '@/lib/dates';
import { releaseDay } from '@/domain/newReleases';
import { artSide, type AboveFirstRow } from '@/player/artSide';
import { playerCopy } from '@/player/copy';
import { playerNote, type PlayableRelease } from '@/player/transport';
import { useSharing } from '@/tally/Sharing';
import { pressedOpacity, ripple, SHEET_TOP, useTokens } from '@/theme/tokens';
import { releaseHeart } from '@/wishlist/target';

const ios = Platform.OS === 'ios';

const useSampleStart = sampleRig?.useSampleStart ?? ((_on: boolean) => undefined);

const SIDE = 24;
const GAP = 14;
const HEAD = ios ? 52 : 48;
const TOP = ios ? 4 : 8;
const TITLE = ios ? 25 : 28;
const SUBTITLE = 21;
const FACTS_GAP = 4;
const FACTS = 18;
const SEEK = 62;
const MAIN = ios ? 72 : 80;
const HEART = ios ? 44 : 48;
/** The art heart's disc and its distance from the art's right and bottom edges. */
const ART_HEART_DISC = ios ? 36 : 40;
const ART_HEART_INSET = 12;
const ART_RADIUS = ios ? 14 : 24;
/** How far below the status bar iOS hangs a page sheet's top edge on an iPhone in portrait. */
const PAGE_SHEET_DROP = 10;
/**
 * The sheet from its top edge to the foot of the first Track row, less the art (artSide). The head, the scroll's top
 * padding, four gaps, the facts gap, the seek line, the transport, the "Tracks" head's padding and one row hold their
 * height: 52 + 4 + 4 x 14 + 4 + 62 + 72 + 16 + 52 = 318pt on iOS, 48 + 8 + 4 x 14 + 4 + 62 + 80 + 20 + 56 = 334dp on
 * Android. The title, subtitle and facts lines (25 + 21 + 18pt, 28 + 21 + 18dp) are Type's and the "Tracks" line (25pt,
 * 24dp) a plain Text's, so 407pt and 425dp in all at the default text size.
 */
const ABOVE_FIRST_ROW: AboveFirstRow = {
  fixed: HEAD + TOP + 4 * GAP + FACTS_GAP + SEEK + MAIN + TRACKS_HEAD_PAD + ROW,
  rowLines: TITLE + SUBTITLE + FACTS,
  plainLines: TRACKS_HEAD_LINE,
};

/** Where the sheet's two ways to the Release page sit: the title and its link on the facts line. */
type OpenSurface = 'sheet_title' | 'sheet_buy';

/** Opens the Release on Bandcamp and counts the hand-off. */
function useOpen(): (release: PlayableRelease, surface: OpenSurface) => void {
  const { track } = useSharing();
  const { isPlaying } = usePlayerActions();
  return (release, surface) => {
    track({ name: 'release_opened_on_bandcamp', props: { surface, was_playing: isPlaying() } });
    openURL(release.url).catch(() => undefined);
  };
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
      <Type scale="fixed" style={style}>{clock(at)}</Type>
      <Type scale="fixed" style={style}>{clock(total)}</Type>
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
  const [anchor, setAnchor] = useState(0);
  const live = status === 'ready' && track !== null;
  const shown = drag ?? Math.min(position, duration || position);
  const fed = drag === null ? shown : anchor;
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
          setAnchor(v);
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

/** The note's line: two of them at the row cap, 2 x 18 x 1.6 = 58, fit the seek block it stands in for (review VIS-1). */
const NOTE_LINE = 18;

/** The note is spoken where it first appears, the mini player or here, by NoticeProvider (VIS-2). */
function Note({ text }: { text: string }) {
  const { c } = useTokens();
  return (
    <View style={{ height: SEEK, justifyContent: 'center' }}>
      <Type numberOfLines={2} style={{ fontSize: 15, lineHeight: NOTE_LINE, color: c.sub, textAlign: 'center' }}>{text}</Type>
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
  const { next, previous, canNext, canPrevious, status } = usePlayer();
  const control = usePlayControl();
  const ready = status === 'ready';
  return (
    <View style={{ height: MAIN, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: ios ? 36 : 20 }}>
      <Skip name="previous" label={playerCopy.previous} onPress={previous} enabled={ready && canPrevious} />
      <Pressable
        onPress={control.onPress}
        disabled={!control.enabled}
        accessibilityRole="button"
        accessibilityLabel={control.label}
        accessibilityState={{ disabled: !control.enabled }}
        android_ripple={ripple(c.onAccent)}
        style={({ pressed }) => ({ width: MAIN, height: MAIN, borderRadius: 28, overflow: ios ? undefined : 'hidden', alignItems: 'center', justifyContent: 'center', backgroundColor: ios ? undefined : c.accent, opacity: pressedOpacity(pressed, control.dim ? 0.4 : 1) })}
      >
        <Glyph name={control.pause ? 'pause' : 'play'} size={ios ? 48 : 36} colour={ios ? c.ink : c.onAccent} />
      </Pressable>
      <Skip name="next" label={playerCopy.next} onPress={next} enabled={ready && canNext} />
    </View>
  );
}

/**
 * The Release's heart on the art's bottom-right corner, its disc ART_HEART_INSET from both edges: the album, or the lone
 * Track a one-Track Release is, never the Track playing in an album, which its tracklist row's heart is for (the author's request of 2026-10-15). It does not wait for the tracklist, the Release being known.
 */
function ReleaseHeart({ release }: { release: PlayableRelease }) {
  const inset = ART_HEART_INSET - (HEART - ART_HEART_DISC) / 2;
  return (
    <View style={{ position: 'absolute', right: inset, bottom: inset }}>
      <Heart item={releaseHeart(release)} box={HEART} icon={ios ? 22 : 24} onArt={ART_HEART_DISC} surface="sheet" />
    </View>
  );
}

/** "Bandcamp ↗" never shrinks, so a long label truncates before it, and its target reaches 44pt over the gaps above and below its 18pt line. */
function Titles({ release }: { release: PlayableRelease }) {
  const { c } = useTokens();
  const player = usePlayer();
  const open = useOpen();
  const title = trackLine(player, release);
  const label = playerCopy.openOnBandcamp(player.track?.title ?? release.title);
  const facts = factsLine(release);
  return (
    <View>
      <Pressable onPress={() => open(release, 'sheet_title')} accessibilityRole="link" accessibilityLabel={label} android_ripple={ripple(c.track)} style={({ pressed }) => ({ opacity: pressedOpacity(pressed) })}>
        <Type numberOfLines={1} style={{ minHeight: TITLE, fontSize: ios ? 20 : 22, lineHeight: TITLE, fontWeight: ios ? '700' : '500', color: c.ink }}>{title}</Type>
        <Type numberOfLines={1} style={{ minHeight: SUBTITLE, fontSize: 16, lineHeight: SUBTITLE, color: c.sub }}>{sheetSubtitle(release.artist, release.title, player.track?.title ?? null)}</Type>
      </Pressable>
      <View style={{ minHeight: FACTS, marginTop: FACTS_GAP, flexDirection: 'row', alignItems: 'center' }}>
        {facts === '' ? null : (
          <Type numberOfLines={1} style={{ flexShrink: 1, fontSize: 13, lineHeight: FACTS, color: c.faint }}>{facts + sep}</Type>
        )}
        <Pressable
          onPress={() => open(release, 'sheet_buy')}
          hitSlop={{ top: 13, bottom: 13, left: 8, right: 12 }}
          accessibilityRole="link"
          accessibilityLabel={label}
          style={({ pressed }) => ({ opacity: pressedOpacity(pressed) })}
        >
          <Type numberOfLines={1} style={{ fontSize: 13, lineHeight: FACTS, color: c.accentText }}>{playerCopy.bandcampLink}</Type>
        </Pressable>
      </View>
    </View>
  );
}

export default function PlayerSheet() {
  const { c } = useTokens();
  const insets = useSafeAreaInsets();
  const { width, height, fontScale } = useWindowDimensions();
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
  // The iOS page sheet hangs under the status bar; Android's bottom sheet is capped SHEET_TOP under it. Either reaches the
  // screen's foot, where the home indicator or the navigation bar covers the last insets.bottom of it.
  const sheet = height - insets.top - (ios ? PAGE_SHEET_DROP : SHEET_TOP);
  const art = artSide(width - SIDE * 2, sheet - insets.bottom, fontScale, ABOVE_FIRST_ROW);
  const note = playerNote(player);
  return (
    <View onAccessibilityEscape={() => router.back()} style={ios ? { flex: 1, backgroundColor: c.surface } : { height: sheet, backgroundColor: c.surface }}>
      <Head />
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        nestedScrollEnabled
        showsVerticalScrollIndicator={false}
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: SIDE, paddingTop: TOP, paddingBottom: (ios ? 0 : insets.bottom) + 32, gap: GAP }}
      >
        <View style={{ alignSelf: 'center', width: art, height: art, borderRadius: ART_RADIUS, backgroundColor: c.surface, boxShadow: '0 16px 40px rgba(0,0,0,0.25)' }}>
          <Artwork hue={current.hue} url={current.artUrl} size={art} radius={ART_RADIUS} />
          <ReleaseHeart release={current} />
        </View>
        <Titles release={current} />
        {note === null ? <SeekLine key={player.track?.trackId ?? 'none'} /> : <Note text={note} />}
        <Transport />
        <Tracklist release={current} side={SIDE} />
      </ScrollView>
    </View>
  );
}

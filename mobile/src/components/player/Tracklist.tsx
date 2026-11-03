/**
 * The player sheet's tracklist (DESIGN-UI sections 10 and 12): a "Tracks" head and one fixed-height row per
 * Track of the Release in the transport, the number in tabular figures, the title and the m:ss trailing. The playing
 * Track swaps its number for a live mark in the accent, three rounded bars on iOS and Material's square equaliser on
 * Android, still while paused or under reduce motion. A Track without a stream is faint, says "no preview" and takes no
 * press; a capped one adds "preview" after its time. A Track not out yet is as faint and says nothing in that slot,
 * only its spoken label naming it. Every playable row carries the heart for its own Track and
 * plays it on a press; nothing draws while the tracklist first loads.
 */
import { useEffect, useState } from 'react';
import { Animated, Easing, Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { Heart } from '@/components/Heart';
import { sep } from '@/copy';
import type { Track } from '@/domain/views';
import { playerCopy } from '@/player/copy';
import { useReduceMotion } from '@/player/motion';
import { isStreamable, type PlayableRelease } from '@/player/transport';
import { PRESS_FLASH, ripple, SCROLL_PRESS_DELAY_MS, useTokens } from '@/theme/tokens';
import { trackHeart } from '@/wishlist/target';

import { clock, usePlayer, usePlayerActions } from './playerState';

const ios = Platform.OS === 'ios';

export const ROW = ios ? 52 : 56;
const HEAD_TOP = ios ? 12 : 16;
const HEAD_BOTTOM = 4;
/** The "Tracks" head's padding and its line at the default text size, which the player sheet counts when it sizes the art. */
export const TRACKS_HEAD_PAD = HEAD_TOP + HEAD_BOTTOM;
export const TRACKS_HEAD_LINE = ios ? 25 : 24;
const NUMBER = ios ? 28 : 32;
const ROW_GAP = ios ? 12 : 16;
const BAR_HEIGHT = ios ? 14 : 16;
const BAR_WIDTH = ios ? 3 : 4;
const BAR_REST = [0.45, 1, 0.7] as const;
const BAR_MS = [420, 540, 360] as const;
const tabular = ['tabular-nums' as const];

function LiveMark({ playing, colour }: { playing: boolean; colour: string }) {
  const reduce = useReduceMotion();
  const [bars] = useState(() => BAR_REST.map((rest) => new Animated.Value(rest)));
  useEffect(() => {
    bars.forEach((bar, i) => bar.setValue(BAR_REST[i] ?? 1));
    if (!playing || reduce) return;
    const loops = bars.map((bar, i) => {
      const ms = BAR_MS[i] ?? 450;
      return Animated.loop(
        Animated.sequence([
          Animated.timing(bar, { toValue: 0.25, duration: ms, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
          Animated.timing(bar, { toValue: 1, duration: ms, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        ]),
      );
    });
    loops.forEach((loop) => loop.start());
    return () => loops.forEach((loop) => loop.stop());
  }, [bars, playing, reduce]);
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ height: BAR_HEIGHT, flexDirection: 'row', alignItems: 'flex-end', gap: ios ? 2 : 1.5 }}
    >
      {bars.map((bar, i) => (
        <Animated.View
          key={i}
          style={{ width: BAR_WIDTH, height: BAR_HEIGHT, borderRadius: ios ? BAR_WIDTH / 2 : 0, backgroundColor: colour, transformOrigin: 'bottom', transform: [{ scaleY: bar }] }}
        />
      ))}
    </View>
  );
}

type RowProps = {
  release: PlayableRelease;
  track: Track;
  index: number;
  current: boolean;
  playing: boolean;
  ready: boolean;
  first: boolean;
  side: number;
};

function rowLabel(track: Track, current: boolean, playing: boolean): string {
  if (!track.out) return playerCopy.trackNotOut(track.trackNum, track.title);
  if (!isStreamable(track)) return playerCopy.silentTrack(track.trackNum, track.title);
  if (current && playing) return playerCopy.pauseTrack(track.trackNum, track.title);
  return playerCopy.playTrack(track.trackNum, track.title);
}

/** The trailing slot: the time, "no preview" for a Track of a Release that is out, nothing for a Track not out yet. */
function trailing(track: Track, live: boolean): string {
  if (!track.out) return '';
  if (!live) return playerCopy.noPreview;
  return track.duration === null ? '' : clock(track.duration);
}

function TrackRow({ release, track, index, current, playing, ready, first, side }: RowProps) {
  const { c, type } = useTokens();
  const { playAt } = usePlayerActions();
  const [down, setDown] = useState(false);
  const live = isStreamable(track);
  const title = !live ? c.faint : current ? c.accentText : c.ink;
  const quiet = live ? c.sub : c.faint;
  const time = trailing(track, live);
  const label = rowLabel(track, current, playing);
  const face = { flex: 1, minWidth: 0, height: ROW, flexDirection: 'row' as const, alignItems: 'center' as const, gap: ROW_GAP, paddingLeft: side };
  const contents = (
    <>
      <View style={{ width: NUMBER, alignItems: 'center', justifyContent: 'center' }}>
        {current ? (
          <LiveMark playing={playing} colour={c.accent} />
        ) : (
          <Text style={{ fontSize: ios ? 15 : 14, color: quiet, fontVariant: tabular }}>{track.trackNum}</Text>
        )}
      </View>
      <Text numberOfLines={1} style={{ flex: 1, fontSize: type.rowTitle, lineHeight: type.rowTitleLine, color: title }}>
        {track.title}
      </Text>
      <Text numberOfLines={1} style={{ fontSize: ios ? 13 : 14, color: quiet, fontVariant: tabular }}>
        {time}
        {live && track.capped ? <Text style={{ fontSize: ios ? 11 : 12, color: c.faint }}>{sep + playerCopy.preview}</Text> : null}
      </Text>
    </>
  );
  return (
    <View style={{ height: ROW, flexDirection: 'row', alignItems: 'center', marginHorizontal: -side, paddingRight: side - 12, backgroundColor: down ? PRESS_FLASH : undefined }}>
      {ios && !first ? (
        <View style={{ position: 'absolute', top: 0, right: 0, left: side + NUMBER + ROW_GAP, height: StyleSheet.hairlineWidth, backgroundColor: c.border }} />
      ) : null}
      {live ? (
        <Pressable
          onPress={() => playAt(index)}
          onPressIn={() => setDown(true)}
          onPressOut={() => setDown(false)}
          disabled={!ready}
          unstable_pressDelay={SCROLL_PRESS_DELAY_MS}
          accessibilityRole="button"
          accessibilityLabel={label}
          accessibilityHint={track.capped ? playerCopy.previewTail : undefined}
          accessibilityState={{ selected: current, disabled: !ready }}
          android_ripple={ripple(c.track)}
          style={face}
        >
          {contents}
        </Pressable>
      ) : (
        <View accessible accessibilityLabel={label} style={face}>
          {contents}
        </View>
      )}
      {live && track.trackId !== null ? (
        <Heart item={trackHeart(release, { trackId: track.trackId, title: track.title })} surface="tracklist" />
      ) : (
        <View style={{ width: ios ? 44 : 48 }} />
      )}
    </View>
  );
}

export function Tracklist({ release, side }: { release: PlayableRelease; side: number }) {
  const { c } = useTokens();
  const { tracks, index, status, playing } = usePlayer();
  if (tracks.length === 0) return null;
  const ready = status === 'ready';
  return (
    <View>
      <Text
        accessibilityRole="header"
        style={{ fontSize: ios ? 20 : 16, lineHeight: TRACKS_HEAD_LINE, fontWeight: ios ? '700' : '500', color: c.ink, paddingTop: HEAD_TOP, paddingBottom: HEAD_BOTTOM }}
      >
        {playerCopy.tracks}
      </Text>
      {tracks.map((track, i) => (
        <TrackRow
          key={track.trackId ?? `n${track.trackNum}`}
          release={release}
          track={track}
          index={i}
          current={i === index}
          playing={playing && i === index}
          ready={ready}
          first={i === 0}
          side={side}
        />
      ))}
    </View>
  );
}

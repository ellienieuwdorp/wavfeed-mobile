/**
 * A foot line that carries the sharing code (task 0044 decision 5): the words flow as one Text per word in a wrapping
 * row, with the bold code, its copy icon and the punctuation after it as one pressable in that row, so the icon aligns
 * the same on iOS and Android and the punctuation never starts a line. Padding offset by a negative margin makes the
 * pressable's own box 44pt tall, since a touch never reaches past its parent's bounds on Android, and its ripple is a
 * borderless circle with a line's height for radius. A press copies the code with the light haptic, and the icon
 * crossfades to an accent checkmark in the same fixed square and back after 2.5 s; a second press restarts that, a
 * failed write brings the copy icon back at once, and reduce motion swaps without the fade. A screen reader hears the
 * line as one paragraph whose activate action copies the code, and hears "Copied" once the clipboard write lands.
 */
import * as Clipboard from 'expo-clipboard';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { Glyph } from '@/components/Glyph';
import { FOOT_BOX, FOOT_SIZE } from '@/components/SettingsList';
import { Type } from '@/components/Type';
import { codeSentence, copy, type CodeLine } from '@/copy';
import { announce } from '@/lib/a11y';
import { turnedOnHaptic } from '@/lib/haptics';
import { useReduceMotion } from '@/player/motion';
import { pressedOpacity, ripple, useTokens } from '@/theme/tokens';
import { scaledSize } from '@/theme/textSize';

const ios = Platform.OS === 'ios';
const s = copy.settings;
/** About the foot's natural line height at the default size, for the hit target only; the words keep GroupFoot's leading. */
const LINE = ios ? 16 : 19;
const ICON = ios ? 14 : 16;
const SHOWN_MS = 2500;
const FADE_MS = 150;
/** The pressable stretched to the 44pt target, and the reach either side of the code. */
const TARGET = 44;
const REACH = 8;

function words(text: string): string[] {
  return text.split(/\s+/).filter((w) => w !== '');
}

export function CodeFoot({ line, code }: { line: CodeLine; code: string }) {
  const { c } = useTokens();
  const { fontScale } = useWindowDimensions();
  const reduceMotion = useReduceMotion();
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );

  // 0 shows the copy icon, 1 the checkmark.
  const check = useSharedValue(0);
  useEffect(() => {
    check.set(reduceMotion ? Number(copied) : withTiming(Number(copied), { duration: FADE_MS }));
  }, [check, copied, reduceMotion]);
  const copyStyle = useAnimatedStyle(() => ({ opacity: 1 - check.get() }));
  const checkStyle = useAnimatedStyle(() => ({ opacity: check.get(), transform: [{ scale: 0.6 + 0.4 * check.get() }] }));

  const copyCode = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    setCopied(true);
    turnedOnHaptic();
    timer.current = setTimeout(() => setCopied(false), SHOWN_MS);
    Clipboard.setStringAsync(code).then(
      () => announce(s.copied),
      () => {
        if (timer.current !== null) clearTimeout(timer.current);
        setCopied(false);
      },
    );
  }, [code]);

  // Android pads a one-line Text with the font's extra leading, which a wrapped paragraph's inner lines do not get.
  const text = { fontSize: FOOT_SIZE, color: c.sub, includeFontPadding: false };
  const before = words(line[0]);
  const [, stuck = '', rest = ''] = /^(\S*)\s*(.*)$/.exec(line[1]) ?? [];
  const after = words(rest);
  const icon = scaledSize(ICON, fontScale, 'row');
  const pad = Math.max(0, (TARGET - scaledSize(LINE, fontScale, 'row')) / 2);

  return (
    <View
      accessible
      accessibilityLabel={codeSentence(line, code)}
      accessibilityHint={ios ? s.copyCode : undefined}
      accessibilityActions={[{ name: 'activate', label: s.copyCode }]}
      onAccessibilityAction={(e) => {
        if (e.nativeEvent.actionName === 'activate') copyCode();
      }}
      // On Android, the font padding GroupFoot's paragraph keeps above its first line, so the turned-off line sits where
      // the foot it replaces did. The zIndex keeps the pressable's 44pt box, which reaches past the line, over the next head.
      style={{ ...FOOT_BOX, ...(ios ? null : { paddingTop: 2 }), flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', zIndex: 1 }}
    >
      {before.map((word, n) => (
        <Type key={`b${n}`} style={text}>{`${word} `}</Type>
      ))}
      <Pressable
        onPress={copyCode}
        accessible={false}
        android_ripple={ripple(c.track, Math.round(scaledSize(LINE, fontScale, 'row')))}
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          paddingVertical: pad,
          marginVertical: -pad,
          paddingHorizontal: REACH,
          marginHorizontal: -REACH,
          opacity: pressedOpacity(pressed),
        })}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
          <Type style={{ ...text, color: c.ink, fontWeight: '600' }}>{code}</Type>
          <View style={{ width: icon, height: icon }}>
            <Animated.View style={[StyleSheet.absoluteFill, copyStyle]}>
              <Glyph name="copy" size={icon} colour={c.accentText} weight="medium" />
            </Animated.View>
            <Animated.View style={[StyleSheet.absoluteFill, checkStyle]}>
              <Glyph name="copied" size={icon} colour={c.accentText} weight="medium" />
            </Animated.View>
          </View>
        </View>
        <Type style={text}>{`${stuck} `}</Type>
      </Pressable>
      {after.map((word, n) => (
        <Type key={`a${n}`} style={text}>{`${word} `}</Type>
      ))}
    </View>
  );
}

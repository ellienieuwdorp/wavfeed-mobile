/**
 * The Filters sheet's own controls (task 0071, decision 7, CSS4's `.stp`, `.isearch` and `.mfield`): neither platform's
 * kit has a stepper that holds its value between minus and plus, so this one is drawn, 32 high on the system's
 * tertiary fill with its value in the middle, minus refused at the low end and plus at the high; the tag search is
 * iOS's rounded search field or Material's outlined one; a tag's mark is a checkbox leading its row, empty or ticked
 * (the author, 2026-10-14): SF Symbols' square and checkmark.square.fill on iOS, crossfaded and scaled as a symbol's
 * replace transition does, and Material's checkbox through @expo/ui's Compose Checkbox on Android, which animates its
 * own tick and is hidden from TalkBack because the row it sits in is the checkbox. Every press here answers on the UI
 * thread, released as the finger lifts and never held for the list behind (`SheetPress`, the author's request of
 * 2026-10-15).
 */
import { Host, Checkbox } from '@expo/ui/jetpack-compose';
import { useEffect, type ReactNode } from 'react';
import {
  Platform,
  PlatformColor,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TouchableNativeFeedback,
  View,
  type AccessibilityProps,
  type ColorValue,
  type Insets,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { Glyph } from '@/components/Glyph';
import { copy } from '@/copy';
import { usePressTone, useReduceMotion } from '@/player/motion';
import { PRESS_DIM, PRESS_FLASH, useTokens } from '@/theme/tokens';

const ios = Platform.OS === 'ios';
/** The iOS checkbox's square; the tag rows' hairline starts past it (app/filters.tsx). */
export const TAG_MARK = 22;

/** iOS's tertiary system fill, which CSS4 draws as `--fill3`; Android takes the same greys. */
export function useFill(): ColorValue {
  const { dark } = useTokens();
  return ios ? PlatformColor('tertiarySystemFill') : dark ? 'rgba(118,118,128,0.24)' : 'rgba(118,118,128,0.12)';
}

/**
 * One adjustable element to a screen reader, its value the sentence it sits in (`spoken`), so a swipe up or down
 * changes the minimum and is heard; the minus and plus inside are for touch only. It reports a step, not a value, so
 * the owner applies it to what it holds when the tap lands.
 */
export function Stepper({ value, min, max, onStep, spoken }: { value: number; min: number; max: number; onStep: (by: 1 | -1) => void; spoken: (n: number) => string }) {
  const { c, dark } = useTokens();
  const fill = useFill();
  const step = (by: 1 | -1, enabled: boolean, glyph: 'minus' | 'plus') => (
    <SheetPress
      feedback="dim"
      onPress={() => onStep(by)}
      disabled={!enabled}
      accessible={false}
      importantForAccessibility="no"
      hitSlop={{ top: 6, bottom: 6 }}
      style={{ width: 38, height: 32, alignItems: 'center', justifyContent: 'center', opacity: enabled ? 1 : 0.45 }}
    >
      <Glyph name={glyph} size={18} colour={enabled ? c.ink : c.faint} weight="medium" />
    </SheetPress>
  );
  const rule = dark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)';
  return (
    <View
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={copy.filter.minimumLabel}
      accessibilityValue={{ min, max, now: value, text: spoken(value) }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={(event) => {
        const by = event.nativeEvent.actionName === 'increment' ? 1 : event.nativeEvent.actionName === 'decrement' ? -1 : 0;
        if (by !== 0 && value + by >= min && value + by <= max) onStep(by);
      }}
      style={{ flexDirection: 'row', alignItems: 'center', height: 32, borderRadius: 8, borderCurve: 'continuous', backgroundColor: fill, overflow: 'hidden', flexShrink: 0 }}
    >
      {step(-1, value > min, 'minus')}
      <Text
        importantForAccessibility="no"
        maxFontSizeMultiplier={1.3}
        style={{ minWidth: 32, height: 20, lineHeight: 20, textAlign: 'center', fontSize: 15, fontWeight: '600', fontVariant: ['tabular-nums'], color: c.ink, borderLeftWidth: 1, borderRightWidth: 1, borderColor: rule }}
      >
        {value}
      </Text>
      {step(1, value < max, 'plus')}
    </View>
  );
}

export function SearchField({ value, onChange, placeholder }: { value: string; onChange: (text: string) => void; placeholder: string }) {
  const { c, dark } = useTokens();
  const fill = useFill();
  const input = (
    <TextInput
      value={value}
      onChangeText={onChange}
      placeholder={placeholder}
      placeholderTextColor={ios ? PlatformColor('placeholderText') : c.sub}
      accessibilityLabel={placeholder}
      autoCapitalize="none"
      autoCorrect={false}
      returnKeyType="search"
      clearButtonMode="while-editing"
      keyboardAppearance={dark ? 'dark' : 'light'}
      cursorColor={c.accent}
      selectionColor={c.accent}
      style={{ flex: 1, fontSize: ios ? 17 : 16, color: c.ink, paddingVertical: 0, height: '100%' }}
    />
  );
  if (ios) {
    return (
      <View style={{ height: 36, borderRadius: 10, borderCurve: 'continuous', backgroundColor: fill, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 8 }}>
        <Glyph name="search" size={18} colour={c.faint} weight="medium" />
        {input}
      </View>
    );
  }
  return (
    <View style={{ height: 56, borderRadius: 4, borderWidth: 1, borderColor: c.sub, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16 }}>
      <Glyph name="search" size={22} colour={c.sub} />
      {input}
    </View>
  );
}

/** How long a tag's mark takes to tick or untick: about a symbol replace's. */
const TICK = { duration: 180, easing: Easing.out(Easing.cubic) };

/** A tag's checkbox: on iOS the square, ticked and filled in the accent when chosen, else empty in the faint tone. */
export function TagMark({ on, onChange }: { on: boolean; onChange: (on: boolean) => void }) {
  const { c, dark } = useTokens();
  if (ios) return <TickedSquare on={on} />;
  return (
    // Claiming the responder keeps a tap on the box from also pressing the row around it.
    <View importantForAccessibility="no-hide-descendants" onStartShouldSetResponder={() => true}>
      <Host matchContents colorScheme={dark ? 'dark' : 'light'} seedColor={c.accent}>
        <Checkbox value={on} onCheckedChange={onChange} colors={{ checkedColor: c.accentText, uncheckedColor: c.sub, checkmarkColor: c.onAccent }} />
      </Host>
    </View>
  );
}

/**
 * The two squares stacked, the ticked one fading and growing in over the empty one as it fades and shrinks out. A row
 * mounts at rest; a change of `on` animates from the sheet's own render, which commits before the list behind starts.
 */
function TickedSquare({ on }: { on: boolean }) {
  const { c } = useTokens();
  const reduceMotion = useReduceMotion();
  const ticked = useSharedValue(on ? 1 : 0);
  useEffect(() => {
    ticked.set(reduceMotion ? Number(on) : withTiming(Number(on), TICK));
  }, [ticked, on, reduceMotion]);
  const emptyStyle = useAnimatedStyle(() => ({ opacity: 1 - ticked.get(), transform: [{ scale: 1 - 0.25 * ticked.get() }] }));
  const tickedStyle = useAnimatedStyle(() => ({ opacity: ticked.get(), transform: [{ scale: 0.6 + 0.4 * ticked.get() }] }));
  return (
    <View style={{ width: TAG_MARK, height: TAG_MARK }}>
      <Animated.View style={[StyleSheet.absoluteFill, emptyStyle]}>
        <Glyph name="boxOff" size={TAG_MARK} colour={c.faint} weight="regular" />
      </Animated.View>
      <Animated.View style={[StyleSheet.absoluteFill, tickedStyle]}>
        <Glyph name="boxOn" size={TAG_MARK} colour={c.accent} weight="regular" />
      </Animated.View>
    </View>
  );
}

type SheetPressProps = {
  onPress: () => void;
  /** `grey`: iOS's grouped cell grey, Android's ripple. `dim`: what it holds dims, on both. */
  feedback?: 'grey' | 'dim';
  disabled?: boolean;
  hitSlop?: Insets;
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
} & Pick<AccessibilityProps, 'accessible' | 'accessibilityRole' | 'accessibilityState' | 'accessibilityLabel' | 'importantForAccessibility'>;

/**
 * A press in the Filters sheet. Its feedback runs on the UI thread from the touch's own events: Android's ripple
 * through TouchableNativeFeedback, which lets go at finger up where Pressable holds a short tap 130 ms on a timer that
 * waits behind the list's render; iOS's grey or dim through usePressTone. The row, the stepper and the bar's buttons
 * share it, so none of them waits for the list behind (the author's request of 2026-10-15).
 */
export function SheetPress({ feedback = 'grey', ...props }: SheetPressProps) {
  if (feedback === 'grey' && !ios) return <Ripple {...props} />;
  return <Toned feedback={feedback} {...props} />;
}

function Ripple({ onPress, disabled, style, children, ...rest }: Omit<SheetPressProps, 'feedback'>) {
  const { c } = useTokens();
  return (
    <TouchableNativeFeedback onPress={onPress} disabled={disabled} background={TouchableNativeFeedback.Ripple(c.track, false)} useForeground {...rest}>
      <View style={style}>{children}</View>
    </TouchableNativeFeedback>
  );
}

function Toned({ feedback, onPress, style, children, ...rest }: SheetPressProps) {
  const { tone, onPressIn, release } = usePressTone();
  const grey = feedback === 'grey';
  const toneStyle = useAnimatedStyle(() => ({ opacity: grey ? tone.get() : 1 - PRESS_DIM * tone.get() }));
  return (
    <Pressable
      onPressIn={onPressIn}
      onPressOut={release}
      onPress={() => {
        release();
        onPress();
      }}
      style={style}
      {...rest}
    >
      {grey ? (
        <>
          <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: PRESS_FLASH }, toneStyle]} />
          {children}
        </>
      ) : (
        <Animated.View style={toneStyle}>{children}</Animated.View>
      )}
    </Pressable>
  );
}

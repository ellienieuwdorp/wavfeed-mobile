/**
 * The Filters sheet's own controls (task 0071, decision 7, CSS4's `.stp`, `.isearch` and `.mfield`): neither platform's
 * kit has a stepper that holds its value between minus and plus, so this one is drawn, 32 high on the system's
 * tertiary fill with its value in the middle, minus refused at the low end and plus at the high; the tag search is
 * iOS's rounded search field or Material's outlined one; a tag's mark is a checkbox leading its row, empty or ticked
 * (the author, 2026-10-14): SF Symbols' square and checkmark.square.fill on iOS, Material's checkbox through @expo/ui's
 * Compose Checkbox on Android, hidden from TalkBack because the row it sits in is the checkbox.
 */
import { Host, Checkbox } from '@expo/ui/jetpack-compose';
import { Platform, PlatformColor, Pressable, Text, TextInput, View, type ColorValue } from 'react-native';

import { Glyph } from '@/components/Glyph';
import { copy } from '@/copy';
import { useTokens } from '@/theme/tokens';

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
    <Pressable
      onPress={enabled ? () => onStep(by) : undefined}
      disabled={!enabled}
      accessible={false}
      importantForAccessibility="no"
      hitSlop={{ top: 6, bottom: 6 }}
      style={({ pressed }) => ({ width: 38, height: 32, alignItems: 'center', justifyContent: 'center', opacity: !enabled ? 0.45 : pressed ? 0.5 : 1 })}
    >
      <Glyph name={glyph} size={18} colour={enabled ? c.ink : c.faint} weight="medium" />
    </Pressable>
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

/** A tag's checkbox: on iOS the square, ticked and filled in the accent when chosen, else empty in the faint tone. */
export function TagMark({ on, onChange }: { on: boolean; onChange: (on: boolean) => void }) {
  const { c, dark } = useTokens();
  if (ios) return <Glyph name={on ? 'boxOn' : 'boxOff'} size={TAG_MARK} colour={on ? c.accent : c.faint} weight="regular" />;
  return (
    // Claiming the responder keeps a tap on the box from also pressing the row around it.
    <View importantForAccessibility="no-hide-descendants" onStartShouldSetResponder={() => true}>
      <Host matchContents colorScheme={dark ? 'dark' : 'light'} seedColor={c.accent}>
        <Checkbox value={on} onCheckedChange={onChange} colors={{ checkedColor: c.accentText, uncheckedColor: c.sub, checkmarkColor: c.onAccent }} />
      </Host>
    </View>
  );
}

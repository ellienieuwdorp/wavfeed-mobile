/**
 * The pieces of the Settings list (task 0036 decision 5, the v2 client canvas, sections 6 and 7): on iOS the inset
 * grouped list, cards at the system corner radius with 17pt rows of at least 44pt, separators starting at the text
 * edge, the grey press flash and a chevron on rows that open something; on Android a flat Material list with accent
 * section heads and the ripple, and Material's small round buttons (filled, tonal, outlined) where the canvas draws
 * actions as buttons. Row and group text grows as row facts, up to the row cap (review VIS-1).
 */
import { Children, createContext, useContext, type ReactNode } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View, type AccessibilityRole } from 'react-native';

import { Glyph } from '@/components/Glyph';
import { Type } from '@/components/Type';
import { PRESS_FLASH, ripple, SCROLL_PRESS_DELAY_MS, useTokens } from '@/theme/tokens';

const ios = Platform.OS === 'ios';
const iosMajor = ios ? parseInt(String(Platform.Version), 10) : 0;

/** ceiling: 26pt is our reading of iOS 26 inset grouped, 10pt before; replace with the UIKit value once checked on device. */
export const GROUP_RADIUS = iosMajor >= 26 ? 26 : 10;
const MARGIN = 16;
const INSET = 16;

const FirstInGroup = createContext(true);

export function GroupHead({ label }: { label: string }) {
  const { c } = useTokens();
  return ios ? (
    <Type accessibilityRole="header" style={{ fontSize: 13, color: c.sub, textTransform: 'uppercase', paddingHorizontal: MARGIN + INSET, paddingTop: 24, paddingBottom: 7 }}>{label}</Type>
  ) : (
    <Type accessibilityRole="header" style={{ fontSize: 14, fontWeight: '500', color: c.accentText, paddingHorizontal: 16, paddingTop: 24, paddingBottom: 8 }}>{label}</Type>
  );
}

export function GroupFoot({ text }: { text: string }) {
  const { c } = useTokens();
  if (text === '') return null;
  return <Type style={ios ? { fontSize: 13, color: c.sub, paddingHorizontal: MARGIN + INSET, paddingTop: 7 } : { fontSize: 14, color: c.sub, paddingHorizontal: 16, paddingBottom: 8 }}>{text}</Type>;
}

export function Group({ children, gapAbove = false }: { children: ReactNode; gapAbove?: boolean }) {
  const { c } = useTokens();
  const rows = Children.toArray(children).map((child, n) => (
    <FirstInGroup key={n} value={n === 0}>
      {child}
    </FirstInGroup>
  ));
  if (!ios) return <View style={{ marginTop: gapAbove ? 16 : 0 }}>{rows}</View>;
  return <View style={{ marginHorizontal: MARGIN, marginTop: gapAbove ? 32 : 0, backgroundColor: c.surface, borderRadius: GROUP_RADIUS, borderCurve: 'continuous', overflow: 'hidden' }}>{rows}</View>;
}

export type Tone = 'ink' | 'accent' | 'danger';

export function Cell({
  title,
  sub,
  leading,
  trailing,
  tone = 'ink',
  navigates = false,
  role,
  checked,
  ownsFocus = false,
  onPress,
}: {
  title: ReactNode;
  sub?: string;
  leading?: ReactNode;
  trailing?: ReactNode;
  tone?: Tone;
  navigates?: boolean;
  role?: AccessibilityRole;
  checked?: boolean;
  /** The trailing control takes its own accessibility focus, so the row does not swallow it (a SwiftUI Toggle on iOS). */
  ownsFocus?: boolean;
  onPress?: () => void;
}) {
  const { c } = useTokens();
  const first = useContext(FirstInGroup);
  const colour = tone === 'accent' ? c.accentText : tone === 'danger' ? c.danger : c.ink;
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessible={ownsFocus ? false : undefined}
      accessibilityRole={role ?? (onPress ? 'button' : undefined)}
      accessibilityState={checked === undefined ? undefined : { checked }}
      android_ripple={{ color: c.track }}
      unstable_pressDelay={SCROLL_PRESS_DELAY_MS}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', paddingLeft: INSET, backgroundColor: pressed ? PRESS_FLASH : undefined })}
    >
      {leading ? <View style={{ marginRight: ios ? 12 : 16 }}>{leading}</View> : null}
      <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: ios ? 44 : 56, paddingRight: INSET }}>
        {ios && !first ? <View style={{ position: 'absolute', top: 0, left: 0, right: 0, height: StyleSheet.hairlineWidth, backgroundColor: c.border }} /> : null}
        <View style={{ flex: 1, gap: 2, paddingVertical: ios ? 11 : 8 }}>
          {typeof title === 'string' ? <Type style={{ fontSize: ios ? 17 : 16, color: colour }}>{title}</Type> : title}
          {sub ? <Type style={{ fontSize: ios ? 13 : 14, color: c.sub }}>{sub}</Type> : null}
        </View>
        {trailing}
        {navigates && ios ? <Glyph name="chevron" size={13} colour={c.faint} /> : null}
      </View>
    </Pressable>
  );
}

export type ButtonKind = 'filled' | 'tonal' | 'outlined';

/** A 40dp Material button, fully round, its touch target stretched to 48dp. */
export function ListButton({ label, kind, busy = false, onPress }: { label: string; kind: ButtonKind; busy?: boolean; onPress?: () => void }) {
  const { c } = useTokens();
  const fill = kind === 'filled' ? c.accentText : kind === 'tonal' ? c.tint : undefined;
  const ink = kind === 'filled' ? c.onAccent : kind === 'tonal' ? c.ink : c.accentText;
  const enabled = onPress !== undefined && !busy;
  return (
    <Pressable
      onPress={enabled ? onPress : undefined}
      disabled={!enabled}
      accessibilityRole="button"
      accessibilityState={{ disabled: !enabled, busy }}
      android_ripple={ripple(kind === 'filled' ? c.onAccent : c.track)}
      hitSlop={{ top: 4, bottom: 4 }}
      style={{ minHeight: 40, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: busy ? 16 : 20, borderRadius: 20, overflow: 'hidden', backgroundColor: fill, borderWidth: kind === 'outlined' ? 1 : 0, borderColor: c.border }}
    >
      {busy ? <ActivityIndicator size={18} color={ink} /> : null}
      <Text style={{ fontSize: 14, lineHeight: 20, fontWeight: '500', color: ink }}>{label}</Text>
    </Pressable>
  );
}

export function ButtonRow({ children }: { children: ReactNode }) {
  return <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 16, paddingTop: 4, paddingBottom: 12 }}>{children}</View>;
}

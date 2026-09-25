/**
 * The pieces of the Settings list: on iOS inset grouped (14pt white groups on
 * the raised background, uppercase 13pt heads), on Android a flat Material list
 * with accent section heads (the v2 client canvas, sections 6 and 7).
 */
import { Children, type ReactNode } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { useTokens } from '@/theme/tokens';

const ios = Platform.OS === 'ios';

export function GroupHead({ label }: { label: string }) {
  const { c } = useTokens();
  return ios ? (
    <Text style={{ fontSize: 13, color: c.sub, textTransform: 'uppercase', letterSpacing: 0.3, paddingHorizontal: 36, paddingTop: 22, paddingBottom: 6 }}>{label}</Text>
  ) : (
    <Text style={{ fontSize: 14, fontWeight: '600', color: c.accent, paddingHorizontal: 16, paddingTop: 22, paddingBottom: 6 }}>{label}</Text>
  );
}

export function GroupFoot({ text }: { text: string }) {
  const { c } = useTokens();
  return <Text style={ios ? { fontSize: 13, color: c.sub, paddingHorizontal: 36, paddingTop: 8 } : { fontSize: 14, color: c.sub, paddingHorizontal: 16, paddingBottom: 8 }}>{text}</Text>;
}

export function Group({ children, gapAbove = false }: { children: ReactNode; gapAbove?: boolean }) {
  const { c } = useTokens();
  if (!ios) return <View>{children}</View>;
  return (
    <View style={{ marginHorizontal: 20, marginTop: gapAbove ? 24 : 0, backgroundColor: c.surface, borderRadius: 14, overflow: 'hidden' }}>
      {Children.toArray(children).map((child, n) => (
        <View key={n}>
          {n > 0 ? <View style={{ position: 'absolute', top: 0, left: 16, right: 0, height: StyleSheet.hairlineWidth, backgroundColor: c.border }} /> : null}
          {child}
        </View>
      ))}
    </View>
  );
}

export type Tone = 'ink' | 'accent' | 'danger';

export function Cell({
  title,
  sub,
  leading,
  trailing,
  tone = 'ink',
  onPress,
}: {
  title: ReactNode;
  sub?: string;
  leading?: ReactNode;
  trailing?: ReactNode;
  tone?: Tone;
  onPress?: () => void;
}) {
  const { c } = useTokens();
  const colour = tone === 'accent' ? c.accent : tone === 'danger' ? c.danger : c.ink;
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: ios ? 12 : 16, minHeight: ios ? 46 : 56, paddingVertical: 6, paddingHorizontal: 16, backgroundColor: pressed ? c.track : undefined })}
    >
      {leading}
      <View style={{ flex: 1, gap: 2 }}>
        {typeof title === 'string' ? <Text style={{ fontSize: 16, color: colour }}>{title}</Text> : title}
        {sub ? <Text style={{ fontSize: ios ? 13 : 14, color: c.sub }}>{sub}</Text> : null}
      </View>
      {trailing}
    </Pressable>
  );
}

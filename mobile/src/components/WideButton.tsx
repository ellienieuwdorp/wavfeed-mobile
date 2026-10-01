/**
 * The full-width button of Connect and the usage ask (the v2 client canvas, section 6): filled in the accent for the
 * press that starts something, tonal for a choice of equal weight beside it, plain for a way out; `busy` holds a spinner in its place. 52pt with the
 * system's rounded corners on iOS, a 48dp pill with the ripple on Android.
 */
import { ActivityIndicator, Platform, Pressable, Text } from 'react-native';

import { pressedOpacity, ripple, useTokens } from '@/theme/tokens';

const ios = Platform.OS === 'ios';

export function WideButton({
  label,
  kind,
  busy = false,
  onPress,
}: {
  label: string;
  kind: 'filled' | 'tonal' | 'plain';
  busy?: boolean;
  onPress: () => void;
}) {
  const { c } = useTokens();
  const fill = kind === 'filled' ? c.accentText : kind === 'tonal' ? c.tint : undefined;
  const ink = kind === 'filled' ? c.onAccent : kind === 'tonal' ? c.ink : c.accentText;
  return (
    <Pressable
      onPress={busy ? undefined : onPress}
      accessibilityRole="button"
      accessibilityState={{ busy }}
      android_ripple={ripple(kind === 'filled' ? c.onAccent : c.track)}
      style={({ pressed }) => ({ minHeight: ios ? 52 : 48, alignItems: 'center', justifyContent: 'center', borderRadius: ios ? 16 : 24, overflow: ios ? undefined : 'hidden', backgroundColor: fill, opacity: pressedOpacity(pressed) })}
    >
      {busy ? <ActivityIndicator color={ink} /> : <Text style={{ fontSize: ios ? 17 : 15, fontWeight: ios ? '600' : '500', color: ink }}>{label}</Text>}
    </Pressable>
  );
}

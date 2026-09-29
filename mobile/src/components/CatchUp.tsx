/**
 * The catch-up while the first walk runs (DESIGN-UI section 9): two lines, the count on top in ink with tabular figures
 * ("1,240 so far") and the work under it, smaller and muted ("gathering your history"), over a hairline whose sweep is
 * indeterminate, since the walk has no total. On iOS 26 it rides the tab bar's accessory until something plays (the
 * count alone when the bar is minimised); otherwise it is a strip in the dock above the mini player, the order section
 * 11 stacks the bottom edge in (task 0036 decision 5). Android's strip moves Compose's Material 3 linear indicator.
 */
import { LinearProgressIndicator, Host as ComposeHost } from '@expo/ui/jetpack-compose';
import { fillMaxWidth } from '@expo/ui/jetpack-compose/modifiers';
import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import { useEffect, useState } from 'react';
import { Animated, Easing, Platform, Text, View } from 'react-native';

import { copy } from '@/copy';
import { useGatherStatus, type StatusLine } from '@/state/status';
import { useTokens } from '@/theme/tokens';

const SWEEP_MS = 1400;
/** The moving segment's share of the track. */
const SEGMENT = 0.3;
const ios = Platform.OS === 'ios';

type CatchUpLine = Extract<StatusLine, { kind: 'catchUp' }>;

export function useCatchUpLine(): CatchUpLine | null {
  const { line } = useGatherStatus();
  return line?.kind === 'catchUp' ? line : null;
}

/** The hairline: a segment slides across it, left to right and again, while a turn is in flight. */
function Sweep({ moving }: { moving: boolean }) {
  const { c } = useTokens();
  const [width, setWidth] = useState(0);
  const [at] = useState(() => new Animated.Value(0));
  useEffect(() => {
    at.setValue(0);
    if (!moving) return;
    const loop = Animated.loop(Animated.timing(at, { toValue: 1, duration: SWEEP_MS, easing: Easing.inOut(Easing.quad), useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [at, moving]);
  const segment = width * SEGMENT;
  return (
    <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)} style={{ height: 2, borderRadius: 1, overflow: 'hidden', backgroundColor: c.track }}>
      {moving && width > 0 ? (
        <Animated.View
          style={{
            width: segment,
            height: 2,
            borderRadius: 1,
            backgroundColor: c.accent,
            transform: [{ translateX: at.interpolate({ inputRange: [0, 1], outputRange: [-segment, width] }) }],
          }}
        />
      ) : null}
    </View>
  );
}

function MaterialSweep({ moving }: { moving: boolean }) {
  const { c, dark } = useTokens();
  return (
    <ComposeHost matchContents={{ vertical: true }} colorScheme={dark ? 'dark' : 'light'} seedColor={c.accent}>
      <LinearProgressIndicator progress={moving ? null : 0} color={c.accent} trackColor={c.tint} modifiers={[fillMaxWidth()]} />
    </ComposeHost>
  );
}

function Words({ line, size, countOnly = false }: { line: CatchUpLine; size: number; countOnly?: boolean }) {
  const { c } = useTokens();
  return (
    <View>
      <Text numberOfLines={1} style={{ fontSize: size, lineHeight: size + 4, fontWeight: '600', color: c.ink, fontVariant: ['tabular-nums'] }}>
        {line.primary}
      </Text>
      {line.secondary && !countOnly ? (
        <Text numberOfLines={1} style={{ fontSize: size - 2, lineHeight: size + 2, color: c.sub }}>{line.secondary}</Text>
      ) : null}
    </View>
  );
}

/** The capsule inside the tab bar accessory; `inline` is the minimised bar's slot. */
export function CatchUpCapsule({ inline }: { inline: boolean }) {
  const line = useCatchUpLine();
  if (line === null) return null;
  return (
    <View
      accessible
      accessibilityLabel={copy.catchUp.label}
      accessibilityLiveRegion="polite"
      style={{ flex: 1, justifyContent: 'center', gap: 4, paddingHorizontal: inline ? 12 : 20 }}
    >
      <Words line={line} size={inline ? 13 : 14} countOnly={inline} />
      {inline ? null : <Sweep moving={line.moving} />}
    </View>
  );
}

/** The strip in the dock above the mini player, where the tab bar's accessory does not carry the catch-up. */
export function CatchUpStrip() {
  const { c, dark, type } = useTokens();
  const line = useCatchUpLine();
  if (line === null) return null;
  const body = (
    <View
      accessible
      accessibilityLabel={copy.catchUp.label}
      accessibilityLiveRegion="polite"
      style={{ gap: ios ? 6 : 8, paddingHorizontal: ios ? 16 : type.gutter, paddingVertical: ios ? 8 : 10 }}
    >
      <Words line={line} size={ios ? 14 : type.sub} />
      {ios ? <Sweep moving={line.moving} /> : <MaterialSweep moving={line.moving} />}
    </View>
  );
  if (ios) {
    const shape = { marginHorizontal: 14, borderRadius: 18, borderCurve: 'continuous' as const, overflow: 'hidden' as const };
    return (
      <GlassView glassEffectStyle="regular" tintColor={`${c.raised}66`} style={[shape, isLiquidGlassAvailable() ? null : { backgroundColor: c.raised }]}>
        {body}
      </GlassView>
    );
  }
  return <View style={{ marginHorizontal: 16, borderRadius: 16, backgroundColor: dark ? c.borderLight : c.surface }}>{body}</View>;
}

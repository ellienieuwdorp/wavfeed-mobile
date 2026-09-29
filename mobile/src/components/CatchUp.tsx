/**
 * The catch-up while the first walk runs (DESIGN-UI section 9): two lines, the count on top in ink with tabular figures
 * ("1,240 so far") and how far back the walk has reached under it, smaller and muted ("back to March 2021"), over a
 * hairline. The hairline fills with the share of Stories `walkProgress` estimates, and sweeps indeterminate while there
 * is none (task 0040). While nothing plays, it rides the iOS 26 tab bar's accessory (the count alone when the bar is
 * minimised), or else a strip in the dock (task 0036 decision 5); once something plays, the header carries it as one
 * line over `CatchUpHairline` (task 0040, decision 6). Words and the hairline on glass take the system's label colours
 * (decision 7). Android's strip moves Compose's Material 3 linear indicator.
 */
import { LinearProgressIndicator, Host as ComposeHost } from '@expo/ui/jetpack-compose';
import { fillMaxWidth } from '@expo/ui/jetpack-compose/modifiers';
import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import { useEffect, useState } from 'react';
import { Animated, Easing, Platform, Text, View } from 'react-native';

import { copy } from '@/copy';
import { useGatherStatus, type CatchUpLine } from '@/state/status';
import { ON_GLASS, useTokens } from '@/theme/tokens';

const SWEEP_MS = 1400;
const FILL_MS = 600;
/** The moving segment's share of the track. */
const SEGMENT = 0.3;
const ios = Platform.OS === 'ios';

export function useCatchUpLine(): CatchUpLine | null {
  return useGatherStatus().catchUp;
}

/** What a screen reader hears while the hairline fills (task 0040); none while it sweeps. */
export function progressValue(fraction: number | null) {
  return fraction === null ? undefined : { min: 0, max: 100, now: Math.round(fraction * 100) };
}

/**
 * The hairline: with a fraction, a fill scaled from the left edge that eases to each new value and holds between
 * turns; without one, a segment slides across it, left to right and again, while a turn is in flight.
 */
function Sweep({ moving, fraction, glass }: { moving: boolean; fraction: number | null; glass: boolean }) {
  const { c } = useTokens();
  const onGlass = glass ? ON_GLASS : null;
  const accent = onGlass?.accent ?? c.accent;
  const [width, setWidth] = useState(0);
  const [at] = useState(() => new Animated.Value(0));
  const [fill] = useState(() => new Animated.Value(fraction ?? 0));
  const sweeping = moving && fraction === null;
  useEffect(() => {
    at.setValue(0);
    if (!sweeping) return;
    const loop = Animated.loop(Animated.timing(at, { toValue: 1, duration: SWEEP_MS, easing: Easing.inOut(Easing.quad), useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [at, sweeping]);
  useEffect(() => {
    if (fraction === null) return;
    const ease = Animated.timing(fill, { toValue: fraction, duration: FILL_MS, easing: Easing.out(Easing.quad), useNativeDriver: true });
    ease.start();
    return () => ease.stop();
  }, [fill, fraction]);
  const segment = width * SEGMENT;
  return (
    <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)} style={{ height: 2, borderRadius: 1, overflow: 'hidden', backgroundColor: onGlass?.track ?? c.track }}>
      {fraction !== null ? (
        <Animated.View style={{ height: 2, backgroundColor: accent, transformOrigin: 'left', transform: [{ scaleX: fill }] }} />
      ) : sweeping && width > 0 ? (
        <Animated.View
          style={{
            width: segment,
            height: 2,
            borderRadius: 1,
            backgroundColor: accent,
            transform: [{ translateX: at.interpolate({ inputRange: [0, 1], outputRange: [-segment, width] }) }],
          }}
        />
      ) : null}
    </View>
  );
}

function MaterialSweep({ moving, fraction }: { moving: boolean; fraction: number | null }) {
  const { c, dark } = useTokens();
  return (
    <ComposeHost matchContents={{ vertical: true }} colorScheme={dark ? 'dark' : 'light'} seedColor={c.accent}>
      <LinearProgressIndicator progress={fraction ?? (moving ? null : 0)} color={c.accent} trackColor={c.tint} modifiers={[fillMaxWidth()]} />
    </ComposeHost>
  );
}

/** The two lines; on iOS glass in the system's label colours (decision 7). */
function Words({ line, size, countOnly = false }: { line: CatchUpLine; size: number; countOnly?: boolean }) {
  const { c } = useTokens();
  return (
    <View>
      <Text numberOfLines={1} style={{ fontSize: size, lineHeight: size + 4, fontWeight: '600', color: ON_GLASS?.ink ?? c.ink, fontVariant: ['tabular-nums'] }}>
        {line.primary}
      </Text>
      {line.secondary && !countOnly ? (
        <Text numberOfLines={1} style={{ fontSize: size - 2, lineHeight: size + 2, color: ON_GLASS?.sub ?? c.sub }}>{line.secondary}</Text>
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
      accessibilityValue={progressValue(line.fraction)}
      accessibilityLiveRegion="polite"
      style={{ flex: 1, justifyContent: 'center', gap: 4, paddingHorizontal: inline ? 12 : 20 }}
    >
      <Words line={line} size={inline ? 13 : 14} countOnly={inline} />
      {inline ? null : <Sweep moving={line.moving} fraction={line.fraction} glass />}
    </View>
  );
}

/** The hairline under the header's line while something plays (decision 6), on the app's own surface. */
export function CatchUpHairline({ line }: { line: CatchUpLine }) {
  return ios ? <Sweep moving={line.moving} fraction={line.fraction} glass={false} /> : <MaterialSweep moving={line.moving} fraction={line.fraction} />;
}

/** The strip in the dock while nothing plays, where the tab bar's accessory does not carry the catch-up. */
export function CatchUpStrip() {
  const { c, dark, type } = useTokens();
  const line = useCatchUpLine();
  if (line === null) return null;
  const body = (
    <View
      accessible
      accessibilityLabel={copy.catchUp.label}
      accessibilityValue={progressValue(line.fraction)}
      accessibilityLiveRegion="polite"
      style={{ gap: ios ? 6 : 8, paddingHorizontal: ios ? 16 : type.gutter, paddingVertical: ios ? 8 : 10 }}
    >
      <Words line={line} size={ios ? 14 : type.sub} />
      {ios ? <Sweep moving={line.moving} fraction={line.fraction} glass /> : <MaterialSweep moving={line.moving} fraction={line.fraction} />}
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

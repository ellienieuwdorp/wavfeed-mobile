/**
 * The catch-up's hairline while the first walk runs (DESIGN-UI section 9), under the header's line of the count and the
 * month (see ScreenHeader, task 0040 decision 8). It fills with the share of Stories `walkProgress` estimates, and
 * sweeps indeterminate while there is none (task 0040). Android moves Compose's Material 3 linear indicator.
 */
import { LinearProgressIndicator, Host as ComposeHost } from '@expo/ui/jetpack-compose';
import { fillMaxWidth } from '@expo/ui/jetpack-compose/modifiers';
import { useEffect, useState } from 'react';
import { Animated, Easing, Platform, View } from 'react-native';

import type { CatchUpLine } from '@/state/status';
import { useTokens } from '@/theme/tokens';

const SWEEP_MS = 1400;
const FILL_MS = 600;
/** The moving segment's share of the track. */
const SEGMENT = 0.3;
const ios = Platform.OS === 'ios';

/** What a screen reader hears while the hairline fills (task 0040); none while it sweeps. */
export function progressValue(fraction: number | null) {
  return fraction === null ? undefined : { min: 0, max: 100, now: Math.round(fraction * 100) };
}

/**
 * The hairline: with a fraction, a fill scaled from the left edge that eases to each new value and holds between
 * turns; without one, a segment slides across it, left to right and again, while a turn is in flight.
 */
function Sweep({ moving, fraction }: { moving: boolean; fraction: number | null }) {
  const { c } = useTokens();
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
    <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)} style={{ height: 2, borderRadius: 1, overflow: 'hidden', backgroundColor: c.track }}>
      {fraction !== null ? (
        <Animated.View style={{ height: 2, backgroundColor: c.accent, transformOrigin: 'left', transform: [{ scaleX: fill }] }} />
      ) : sweeping && width > 0 ? (
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

function MaterialSweep({ moving, fraction }: { moving: boolean; fraction: number | null }) {
  const { c, dark } = useTokens();
  return (
    <ComposeHost matchContents={{ vertical: true }} colorScheme={dark ? 'dark' : 'light'} seedColor={c.accent}>
      <LinearProgressIndicator progress={fraction ?? (moving ? null : 0)} color={c.accent} trackColor={c.tint} modifiers={[fillMaxWidth()]} />
    </ComposeHost>
  );
}

/** The hairline under the header's line (task 0040, decision 8). */
export function CatchUpHairline({ line }: { line: Pick<CatchUpLine, 'moving' | 'fraction'> }) {
  return ios ? <Sweep moving={line.moving} fraction={line.fraction} /> : <MaterialSweep moving={line.moving} fraction={line.fraction} />;
}

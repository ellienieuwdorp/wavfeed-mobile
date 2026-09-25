/**
 * The in-scroll half of a view's header, under the native large title: "Updated 12 min ago", or while the first walk
 * runs the catch-up pair, the count in ink over the work in sub with a moving hairline (DESIGN-UI section 9, the v2
 * client canvas's first gather board). Nothing before the first gather.
 */
import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Text, View } from 'react-native';

import { copy } from '@/copy';
import { useGatherStatus } from '@/state/status';
import { useTokens } from '@/theme/tokens';

const SWEEP_MS = 1400;

function Hairline() {
  const { c } = useTokens();
  const [width, setWidth] = useState(0);
  const x = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.timing(x, { toValue: 1, duration: SWEEP_MS, easing: Easing.inOut(Easing.quad), useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [x]);
  const segment = width / 3;
  return (
    <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)} style={{ height: 2, marginTop: 6, backgroundColor: c.track, overflow: 'hidden', borderRadius: 1 }}>
      <Animated.View
        style={{
          width: segment,
          height: 2,
          backgroundColor: c.accent,
          transform: [{ translateX: x.interpolate({ inputRange: [0, 1], outputRange: [-segment, width] }) }],
        }}
      />
    </View>
  );
}

export function ScreenHeader() {
  const { c, type } = useTokens();
  const { line } = useGatherStatus();
  if (line === null) return <View style={{ height: 12 }} />;
  if (line.kind === 'updated') {
    return <Text style={{ fontSize: type.sub, color: c.sub, paddingHorizontal: type.gutter, paddingBottom: 12 }}>{line.text}</Text>;
  }
  return (
    <View accessibilityLabel={copy.catchUp.label} accessibilityLiveRegion="polite" style={{ paddingHorizontal: type.gutter, paddingBottom: 12 }}>
      <Text style={{ fontSize: type.sub, color: c.ink, fontVariant: ['tabular-nums'] }}>{line.primary}</Text>
      {line.secondary ? <Text style={{ fontSize: type.sub - 1, color: c.sub }}>{line.secondary}</Text> : null}
      <Hairline />
    </View>
  );
}

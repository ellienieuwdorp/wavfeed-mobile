/**
 * The week head (DESIGN-UI section 3): a full-bleed band, "LAST WEEK · Mon 9 – Sun 15 Nov", the week in 11pt bold
 * capitals, a middot and its range in 12pt sub colour, laid out as a row 6 apart that wraps at larger text, all with
 * tabular figures. The band is one header element that speaks the week and range as written, since the capitals are a
 * text transform. React Native's sticky header stops at the top of the list's frame, which runs under the iOS 26 glass
 * bar and Android's drawn app bar, so `useWeekBands` hands the list a sticky header that reads the scroll offset
 * shifted by the bar's cover (TabStack's useBarCover). While a band is stuck under the glass bar, the bar fills with the
 * band's colour and drops its scroll edge effect, so bar and band read as one block.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ComponentType, type ReactNode } from 'react';
import { Animated, Platform, View, type LayoutChangeEvent } from 'react-native';
// @ts-expect-error: React Native ships ScrollView's own sticky header with no types at its path.
import ScrollViewStickyHeader from 'react-native/Libraries/Components/ScrollView/ScrollViewStickyHeader';
import { useNavigation } from 'expo-router';
import type { NativeStackNavigationOptions } from 'expo-router/native-stack';

import { isGlassBar, useBarCover } from '@/components/TabStack';
import { sep } from '@/copy';
import { useReduceMotion } from '@/player/motion';
import { useTokens } from '@/theme/tokens';

import { Type } from './Type';

/** 1 + 10 + 14 + 10 + 1: the band is 36 high at the default text size, its rules included; larger text grows it. */
const BAND_PAD = 10;
const LINE = 14;
/** A stuck band stops this far under the bar's edge, so its top rule sits under the filled bar and leaves no seam. */
const TUCK = 1;
/** The bar's fill crossfades in and out over this long as the first band sticks and lets go. */
const FILL_MS = 150;
/** Taller than any bar; the fill is this high and slid up so its bottom edge meets the bar's. */
const FILL_SPAN = 400;

export function WeekHead({ week, range }: { week: string; range?: string }) {
  const { c, type } = useTokens();
  const heard = range ? week + sep + range : week;
  return (
    <View
      accessible
      accessibilityRole="header"
      accessibilityLabel={heard}
      style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6, paddingHorizontal: type.gutter, paddingVertical: BAND_PAD, backgroundColor: c.weekBand, borderTopWidth: 1, borderBottomWidth: 1, borderColor: c.weekBandEdge }}
    >
      <Type style={{ fontSize: 11, lineHeight: LINE, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase', color: c.ink, fontVariant: ['tabular-nums'] }}>{week}</Type>
      {range ? (
        <>
          <Type style={{ fontSize: 12, lineHeight: LINE, color: c.sub }}>{sep.trim()}</Type>
          <Type style={{ fontSize: 12, lineHeight: LINE, color: c.sub, fontVariant: ['tabular-nums'] }}>{range}</Type>
        </>
      ) : null}
    </View>
  );
}

/** What ScrollView hands its sticky header (ScrollView.js): the scroll offset, the header's layout and the next one's. */
type StickyProps = { scrollAnimatedValue: Animated.Value; onLayout: (event: LayoutChangeEvent) => void; [prop: string]: unknown };

/** React Native's header only interpolates the scroll value, so an offset shifted by the cover drives it as well. */
const Sticky: ComponentType<{ scrollAnimatedValue: Animated.AnimatedAddition; [prop: string]: unknown }> = ScrollViewStickyHeader;

/** One list's bands: which of them are stuck, and the bar's fill, which shows while any is. */
type Bands = { readonly fill: Animated.Value; readonly stuck: Set<object>; flip: (on: boolean) => void };

function hold(bands: Bands, band: object, on: boolean) {
  const was = bands.stuck.size > 0;
  if (on) bands.stuck.add(band);
  else bands.stuck.delete(band);
  const now = bands.stuck.size > 0;
  if (now !== was) bands.flip(now);
}

function Stuck({ pushed, bands, scrollAnimatedValue, onLayout, ...props }: StickyProps & { pushed: boolean; bands: Bands }) {
  const cover = useBarCover(pushed);
  // iOS's automatic inset puts a list at rest at a negative offset (minus the inset), but the scroll value reads 0 until
  // the list's first scroll event, which would stick the first band at once; the cover joins once that offset arrives.
  const [gate] = useState(() => new Animated.Value(Platform.OS === 'ios' ? 0 : 1));
  useEffect(() => {
    if (Platform.OS !== 'ios') return undefined;
    const id = scrollAnimatedValue.addListener(({ value }) => {
      if (value < 0) gate.setValue(1);
    });
    return () => scrollAnimatedValue.removeListener(id);
  }, [scrollAnimatedValue, gate]);
  // Past its own y less the cover, the header moves with the offset and holds `cover - TUCK` below the frame's top.
  const shifted = useMemo(() => Animated.add(scrollAnimatedValue, Animated.multiply(gate, Animated.add(cover, -TUCK))), [scrollAnimatedValue, gate, cover]);
  // The band is stuck once the shifted offset passes its own y, where React Native's header starts to move.
  const y = useRef<number | null>(null);
  const [band] = useState(() => ({}));
  useEffect(() => {
    const id = shifted.addListener(({ value }) => hold(bands, band, y.current !== null && value > y.current));
    return () => {
      shifted.removeListener(id);
      hold(bands, band, false);
    };
  }, [shifted, bands, band]);
  const laidOut = (event: LayoutChangeEvent) => {
    y.current = event.nativeEvent.layout.y;
    onLayout(event);
  };
  return <Sticky {...props} onLayout={laidOut} scrollAnimatedValue={shifted} />;
}

/** The glass bar's fill (`headerBackground`): the band's colour, its bottom edge on the bar's, faded in by `fill`. */
function BarFill({ fill }: { fill: Animated.Value }) {
  const { c } = useTokens();
  const cover = useBarCover(false);
  const lift = useMemo(() => Animated.add(cover, -FILL_SPAN), [cover]);
  return <Animated.View style={{ position: 'absolute', top: 0, left: 0, right: 0, height: FILL_SPAN, backgroundColor: c.weekBand, opacity: fill, transform: [{ translateY: lift }] }} />;
}

/** The sticky header a list's bands stand in, made once per list so it holds that list's `Bands`. */
function stuckIn(bands: Bands, pushed: boolean): (props: StickyProps) => ReactNode {
  return function Band(props: StickyProps) {
    return <Stuck {...props} pushed={pushed} bands={bands} />;
  };
}

type Options = { setOptions: (options: Partial<NativeStackNavigationOptions>) => void };

/**
 * A FlatList's props that stick its week heads, the items of kind `week`; `pushed` is a screen the tab's view pushed.
 * Under the glass bar the screen's header takes the fill as its background, and while a band is stuck the bar's fill
 * fades in over FILL_MS, at once under reduce motion, and the list's top scroll edge effect is hidden.
 */
export function useWeekBands(items: readonly { kind: string }[], pushed = false) {
  const navigation = useNavigation<Options>();
  const reduce = useReduceMotion();
  const latest = useRef({ navigation, reduce });
  useEffect(() => {
    latest.current = { navigation, reduce };
  }, [navigation, reduce]);
  const [bands] = useState<Bands>(() => {
    const fill = new Animated.Value(0);
    return {
      fill,
      stuck: new Set(),
      flip: (on) => {
        if (!isGlassBar) return;
        const { navigation: nav, reduce: still } = latest.current;
        nav.setOptions({ scrollEdgeEffects: { top: on ? 'hidden' : 'automatic' } });
        fill.stopAnimation();
        if (still) fill.setValue(on ? 1 : 0);
        else Animated.timing(fill, { toValue: on ? 1 : 0, duration: FILL_MS, useNativeDriver: true }).start();
      },
    };
  });
  const [StickyHeaderComponent] = useState(() => stuckIn(bands, pushed));
  useLayoutEffect(() => {
    if (isGlassBar) navigation.setOptions({ headerBackground: () => <BarFill fill={bands.fill} /> });
  }, [navigation, bands]);
  const stickyHeaderIndices = useMemo(() => items.flatMap((item, at) => (item.kind === 'week' ? [at] : [])), [items]);
  return { stickyHeaderIndices, StickyHeaderComponent };
}

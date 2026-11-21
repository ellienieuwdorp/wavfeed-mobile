/**
 * The week head (DESIGN-UI section 3): a full-bleed band, "LAST WEEK · Mon 9 – Sun 15 Nov", the week in 11pt bold
 * capitals and its range in 12pt sub colour, one header element that speaks both as written, since the capitals are a
 * text transform. React Native's sticky header stops at the top of the list's frame, which runs under the iOS 26 glass
 * bar and Android's drawn app bar, so `useWeekBands` hands the list a sticky header that reads the scroll offset
 * shifted by the bar's cover (TabStack's useBarCover). As the first band sticks under the glass bar, the bar fills with
 * the band's colour over the next FILL_RUN of scroll and, once solid, drops its scroll edge effect, so bar and band read
 * as one block.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ComponentType, type ReactNode } from 'react';
import { Animated, Platform, View, type LayoutChangeEvent } from 'react-native';
// @ts-expect-error: React Native ships ScrollView's own sticky header with no types at its path.
import ScrollViewStickyHeader from 'react-native/Libraries/Components/ScrollView/ScrollViewStickyHeader';
import { useNavigation } from 'expo-router';
import type { NativeStackNavigationOptions } from 'expo-router/native-stack';

import { glassBar, useBarCover } from '@/components/TabStack';
import { sep } from '@/copy';
import { useTokens } from '@/theme/tokens';

import { Type } from './Type';

const ios = Platform.OS === 'ios';
/** 1 + 10 + 14 + 10 + 1: the band is 36 high at the default text size, its rules included; larger text grows it. */
const BAND_PAD = 10;
const LINE = 14;
/** A stuck band stops this far under the bar's edge, so its top rule sits under the filled bar and leaves no seam. */
const TUCK = 1;
/**
 * The bar's fill runs from clear to whole over this much scroll past the first band's stick point, the band's own height
 * at the default text size, so it is whole before any row clears the band into the bar. It follows the offset with no
 * clock, so it needs no reduce motion path. Its curve is a quadratic ease out: half the fill lands in the first 30% of
 * the run.
 */
const FILL_RUN = 2 * (1 + BAND_PAD) + LINE;
const FILL_STEPS = [0, 0.25, 0.5, 0.75, 1];
const FILL_AT = FILL_STEPS.map((at) => at * FILL_RUN);
const FILL_TO = FILL_STEPS.map((at) => 1 - (1 - at) ** 2);
/** The first band's y while no band is laid out, past any offset, so the fill stays clear. */
const NO_BAND = 1e6;
/** Taller than any bar; the fill is this high and slid up so its bottom edge meets the bar's. */
const FILL_SPAN = 400;
/** The room a week's first and last rows add beside its bands, so the 4 a row leaves round its art grows to 12. */
const WEEK_AIR = 8;

export function WeekHead({ week, range }: { week: string; range?: string }) {
  const { c, type } = useTokens();
  return (
    <View
      accessible
      accessibilityRole="header"
      accessibilityLabel={range ? week + sep + range : week}
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

/** A row of a week, WEEK_AIR clear of its band when `first` and of the next band when `last`. */
export function WeekRow({ first, last, children }: { first: boolean; last: boolean; children: ReactNode }) {
  if (!first && !last) return children;
  return <View style={{ paddingTop: first ? WEEK_AIR : 0, paddingBottom: last ? WEEK_AIR : 0 }}>{children}</View>;
}

/** What ScrollView hands its sticky header (ScrollView.js): the scroll offset, the header's layout and the next one's. */
type StickyProps = { scrollAnimatedValue: Animated.Value; onLayout: (event: LayoutChangeEvent) => void; [prop: string]: unknown };

/** React Native's header only interpolates the scroll value, so an offset shifted by the cover drives it as well. */
const Sticky: ComponentType<{ scrollAnimatedValue: Animated.AnimatedAddition; [prop: string]: unknown }> = ScrollViewStickyHeader;

type Cover = ReturnType<typeof useBarCover>;

/** A list's scroll offset shifted by the bar's cover, and the bar's fill as a function of it. */
type Line = { readonly scroll: Animated.Value; readonly cover: Cover; readonly shifted: Animated.AnimatedAddition; readonly fill: Animated.AnimatedInterpolation<number> };

/**
 * One list's bands: the gate that lets the cover in, each mounted band's y and the least of them, the list's line once a
 * band has seen its scroll value, the bar fills that follow it, and the setter for whether the bar is solid.
 */
type Bands = {
  readonly gate: Animated.Value;
  readonly ys: Map<object, number>;
  readonly first: Animated.Value;
  line: Line | null;
  readonly watch: (show: () => void) => () => void;
  readonly show: () => void;
  readonly solid: (on: boolean) => void;
};

function lineOf(bands: Bands, scroll: Animated.Value, cover: Cover): Line {
  if (bands.line?.scroll === scroll && bands.line.cover === cover) return bands.line;
  // Past its own y less the cover, a header moves with the offset and holds `cover - TUCK` below the frame's top.
  const shifted = Animated.add(scroll, Animated.multiply(bands.gate, Animated.add(cover, -TUCK)));
  const fill = Animated.subtract(shifted, bands.first).interpolate({ inputRange: FILL_AT, outputRange: FILL_TO, extrapolate: 'clamp' });
  bands.line = { scroll, cover, shifted, fill };
  return bands.line;
}

function firstOf(bands: Bands): number {
  return bands.ys.size > 0 ? Math.min(...bands.ys.values()) : NO_BAND;
}

function Stuck({ pushed, bands, scrollAnimatedValue, onLayout, ...props }: StickyProps & { pushed: boolean; bands: Bands }) {
  const cover = useBarCover(pushed);
  const { shifted } = useMemo(() => lineOf(bands, scrollAnimatedValue, cover), [bands, scrollAnimatedValue, cover]);
  useEffect(() => bands.show(), [bands, shifted]);
  // iOS's automatic inset puts a list at rest at a negative offset (minus the inset), but the scroll value reads 0 until
  // the list's first scroll event, which would stick the first band at once; the cover joins once that offset arrives.
  // The gate is the list's, so a band mounted deep in the list after that event stops under the bar as well.
  useEffect(() => {
    if (!ios) return undefined;
    const id = scrollAnimatedValue.addListener(({ value }) => {
      if (value < 0) bands.gate.setValue(1);
    });
    return () => scrollAnimatedValue.removeListener(id);
  }, [scrollAnimatedValue, bands]);
  // The bar is solid once the fill is whole, FILL_RUN past the first band's y.
  useEffect(() => {
    const id = shifted.addListener(({ value }) => bands.solid(value >= firstOf(bands) + FILL_RUN));
    return () => shifted.removeListener(id);
  }, [shifted, bands]);
  const [band] = useState(() => ({}));
  useEffect(
    () => () => {
      bands.ys.delete(band);
      bands.first.setValue(firstOf(bands));
      if (bands.ys.size === 0) bands.solid(false);
    },
    [bands, band],
  );
  const laidOut = (event: LayoutChangeEvent) => {
    bands.ys.set(band, event.nativeEvent.layout.y);
    bands.first.setValue(firstOf(bands));
    onLayout(event);
  };
  return <Sticky {...props} onLayout={laidOut} scrollAnimatedValue={shifted} />;
}

/** The glass bar's fill (`headerBackground`): the band's colour, its bottom edge on the bar's, its opacity the list's fill. */
function BarFill({ bands }: { bands: Bands }) {
  const { c } = useTokens();
  const cover = useBarCover(false);
  const lift = useMemo(() => Animated.add(cover, -FILL_SPAN), [cover]);
  const fill = useSyncExternalStore(bands.watch, () => bands.line?.fill ?? 0);
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
 * Under the glass bar the screen's header takes the fill as its background, and once the bar is solid the list's top
 * scroll edge effect is hidden.
 */
export function useWeekBands(items: readonly { kind: string }[], pushed = false) {
  const navigation = useNavigation<Options>();
  const latest = useRef(navigation);
  useEffect(() => {
    latest.current = navigation;
  }, [navigation]);
  const [bands] = useState<Bands>(() => {
    const fills = new Set<() => void>();
    let solid = false;
    return {
      gate: new Animated.Value(ios ? 0 : 1),
      ys: new Map(),
      first: new Animated.Value(NO_BAND),
      line: null,
      watch: (show) => {
        fills.add(show);
        return () => fills.delete(show);
      },
      show: () => {
        for (const show of fills) show();
      },
      solid: (on) => {
        if (on === solid) return;
        solid = on;
        if (glassBar) latest.current.setOptions({ scrollEdgeEffects: { top: on ? 'hidden' : 'automatic' } });
      },
    };
  });
  const [StickyHeaderComponent] = useState(() => stuckIn(bands, pushed));
  useLayoutEffect(() => {
    if (glassBar) navigation.setOptions({ headerBackground: () => <BarFill bands={bands} /> });
  }, [navigation, bands]);
  const stickyHeaderIndices = useMemo(() => items.flatMap((item, at) => (item.kind === 'week' ? [at] : [])), [items]);
  return { stickyHeaderIndices, StickyHeaderComponent };
}

/**
 * The week head (DESIGN-UI section 3): a full-bleed band, "LAST WEEK · Mon 9 – Sun 15 Nov", the week in 11pt bold
 * capitals, a middot and its range in 12pt sub colour, laid out as a row 6 apart that wraps at larger text, all with
 * tabular figures. The band is one header element that speaks the week and range as written, since the capitals are a
 * text transform. React Native's sticky header stops at the top of the list's frame, which runs under the iOS 26 glass
 * bar and Android's drawn app bar, so `stickyWeekHeads` hands the list a sticky header that reads the scroll offset
 * shifted by the bar's cover (TabStack's useBarCover).
 */
import { useEffect, useMemo, useState, type ComponentType } from 'react';
import { Animated, Platform, View } from 'react-native';
// @ts-expect-error: React Native ships ScrollView's own sticky header with no types at its path.
import ScrollViewStickyHeader from 'react-native/Libraries/Components/ScrollView/ScrollViewStickyHeader';

import { useBarCover } from '@/components/TabStack';
import { sep } from '@/copy';
import { useTokens } from '@/theme/tokens';

import { Type } from './Type';

/** 1 + 7 + 14 + 7 + 1: the band is 30 high at the default text size, its rules included; larger text grows it. */
const BAND_PAD = 7;
const LINE = 14;

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
type StickyProps = { scrollAnimatedValue: Animated.Value; [prop: string]: unknown };

/** React Native's header only interpolates the scroll value, so an offset shifted by a constant drives it as well. */
const Sticky: ComponentType<{ scrollAnimatedValue: Animated.AnimatedAddition; [prop: string]: unknown }> = ScrollViewStickyHeader;

function Stuck({ pushed, scrollAnimatedValue, ...props }: StickyProps & { pushed: boolean }) {
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
  // Past its own y less the cover, the header moves with the offset and holds `cover` below the frame's top.
  const shifted = useMemo(() => Animated.add(scrollAnimatedValue, Animated.multiply(gate, cover)), [scrollAnimatedValue, gate, cover]);
  return <Sticky {...props} scrollAnimatedValue={shifted} />;
}

function UnderTabBar(props: StickyProps) {
  return <Stuck {...props} pushed={false} />;
}

function UnderPushedBar(props: StickyProps) {
  return <Stuck {...props} pushed />;
}

/** A FlatList's props that stick its week heads, the items of kind `week`; `pushed` is a screen the tab's view pushed. */
export function stickyWeekHeads(items: readonly { kind: string }[], pushed = false) {
  return {
    stickyHeaderIndices: items.flatMap((item, at) => (item.kind === 'week' ? [at] : [])),
    StickyHeaderComponent: pushed ? UnderPushedBar : UnderTabBar,
  };
}

/**
 * Android's medium flexible app bar (task 0036 decision 5, the v2 client canvas, section 7): the view's title at 28sp
 * with "Updated 12 min ago" under it scrolls with the list, and once it has gone under the status bar a 64dp bar on the
 * surface-container tone fades in with the title at 22sp and the subtitle at 12sp. Edge to edge, the status bar's strip
 * always carries the page tone or the bar's. With the font scale the expanded title grows as a head and its subtitle as
 * a row fact, and both lines of the collapsed bar as heads, which keeps them inside its 64dp (review VIS-1). iOS
 * draws its large title natively (see TabStack), so every hook here is inert there.
 */
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { Animated, Platform, View, type NativeScrollEvent, type NativeSyntheticEvent, type ViewProps } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { FilterEaseLine } from '@/components/filter/FilterEase';
import { FilterLineSlot } from '@/components/filter/FilterLineSlot';
import { useTokens } from '@/theme/tokens';

import { Type } from './Type';

const BAR = 64;
const TITLE_TOP = 8;
const TITLE_LINE = 36;
/** The list offset past which the expanded title counts as gone and the collapsed bar shows. */
const COLLAPSE_AT = TITLE_TOP + TITLE_LINE / 2;
const FADE_MS = 150;

type Frame = { title: string; subtitle: string | null; setSubtitle: (s: string | null) => void; setCollapsed: (on: boolean) => void };

const FrameContext = createContext<Frame | null>(null);

type ScrollProps = { onScroll?: (e: NativeSyntheticEvent<NativeScrollEvent>) => void; scrollEventThrottle?: number };

/** What a tab's list spreads on itself: the scroll listener that collapses the bar, and where its refresh spinner starts. */
export function useAppBar(): { scroll: ScrollProps; refreshOffset: number | undefined } {
  const frame = useContext(FrameContext);
  const insets = useSafeAreaInsets();
  if (frame === null) return { scroll: {}, refreshOffset: undefined };
  const { setCollapsed } = frame;
  return {
    scroll: { onScroll: (e) => setCollapsed(e.nativeEvent.contentOffset.y > COLLAPSE_AT), scrollEventThrottle: 32 },
    refreshOffset: insets.top + TITLE_TOP,
  };
}

/** A screen pushed over the tab's view draws its own native header, so the collapsed bar stands down while it is up (task 0037). */
export function useAppBarAtRest(): void {
  const setCollapsed = useContext(FrameContext)?.setCollapsed;
  useEffect(() => {
    setCollapsed?.(false);
  }, [setCollapsed]);
}

/**
 * The expanded half, first in the list: the title and, when there is one, the subtitle line, with `below` under it
 * (the note to keep the app open and the catch-up's hairline, task 0040 decision 8) and `a11y` on the pair. With
 * `filterable`, New releases', the subtitle line and the "Filtered by" pill share one place held at the pill's height,
 * 16 under the title's glyphs, and under the catch-up the pill's place is held empty (see FilterLineSlot).
 */
export function AppBarTitle({
  subtitle,
  below = null,
  a11y = {},
  pill = null,
  filterable = false,
  barSubtitle = subtitle,
}: {
  subtitle: string | null;
  below?: ReactNode;
  a11y?: ViewProps;
  /** New releases' "Filtered by" pill (task 0071, decision 6). */
  pill?: ReactNode;
  filterable?: boolean;
  /** The collapsed bar's subtitle, when it is not the expanded one's. */
  barSubtitle?: string | null;
}) {
  const frame = useContext(FrameContext);
  const insets = useSafeAreaInsets();
  const { c, type } = useTokens();
  const setSubtitle = frame?.setSubtitle;
  useEffect(() => {
    setSubtitle?.(barSubtitle);
  }, [setSubtitle, barSubtitle]);
  if (frame === null) return null;
  const line = subtitle === null ? null : <Type numberOfLines={1} style={{ fontSize: type.sub, lineHeight: 20, color: c.sub }}>{subtitle}</Type>;
  // New releases' subtitle gives way to its pill crossfaded with the rows (components/filter/FilterEase.tsx).
  const lines =
    line === null ? null : (
      <FilterEaseLine key="subtitle">
        <View {...a11y} style={{ gap: 8 }}>
          {line}
          {below}
        </View>
      </FilterEaseLine>
    );
  const swapped = filterable && below === null;
  return (
    <View style={{ paddingTop: insets.top + TITLE_TOP, paddingHorizontal: type.gutter, paddingBottom: subtitle === null || swapped ? 16 : 12 }}>
      <Type scale="head" accessibilityRole="header" numberOfLines={1} style={{ fontSize: type.viewTitle, lineHeight: TITLE_LINE, color: c.ink }}>{frame.title}</Type>
      {swapped ? (
        <View style={{ marginTop: PILL_TOP }}>
          <FilterLineSlot strut={line}>{pill ?? lines}</FilterLineSlot>
        </View>
      ) : (
        <>
          {lines}
          {filterable ? (
            <View style={{ marginTop: 12 }}>
              <FilterLineSlot strut={null}>{pill}</FilterLineSlot>
            </View>
          ) : null}
        </>
      )}
    </View>
  );
}

/** The title's line box and the box's padding leave 8 under its glyphs at 28sp; 8 more puts the pill 16 below them. */
const PILL_TOP = 8;

function CollapsedBar({ collapsed, background }: { collapsed: boolean; background: string }) {
  const { c } = useTokens();
  const insets = useSafeAreaInsets();
  const frame = useContext(FrameContext);
  const [opacity] = useState(() => new Animated.Value(0));
  useEffect(() => {
    Animated.timing(opacity, { toValue: collapsed ? 1 : 0, duration: FADE_MS, useNativeDriver: true }).start();
  }, [collapsed, opacity]);
  return (
    <>
      <View style={{ position: 'absolute', top: 0, left: 0, right: 0, height: insets.top, backgroundColor: background, pointerEvents: 'none' }} />
      <Animated.View
        importantForAccessibility="no-hide-descendants"
        style={{ position: 'absolute', top: 0, left: 0, right: 0, height: insets.top + BAR, paddingTop: insets.top, paddingHorizontal: 16, justifyContent: 'center', backgroundColor: c.raised, opacity, pointerEvents: collapsed ? 'auto' : 'none' }}
      >
        <Type scale="head" numberOfLines={1} style={{ fontSize: 22, lineHeight: 28, color: c.ink }}>{frame?.title}</Type>
        {frame?.subtitle ? <Type scale="head" numberOfLines={1} style={{ fontSize: 12, lineHeight: 16, color: c.sub }}>{frame.subtitle}</Type> : null}
      </Animated.View>
    </>
  );
}

/** react-native-screens cannot collapse an Android toolbar on scroll, so the tab's stack draws this one over itself. */
export function AppBarFrame({ title, background, children }: { title: string; background: string; children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const [subtitle, setSubtitle] = useState<string | null>(null);
  if (Platform.OS !== 'android') return children;
  return (
    <FrameContext value={{ title, subtitle, setSubtitle, setCollapsed }}>
      <View style={{ flex: 1 }}>
        {children}
        <CollapsedBar collapsed={collapsed} background={background} />
      </View>
    </FrameContext>
  );
}

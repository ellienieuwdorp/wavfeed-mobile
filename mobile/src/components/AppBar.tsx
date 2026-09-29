/**
 * Android's medium flexible app bar (task 0036 decision 5, the v2 client canvas, section 7): the view's title at 28sp
 * with "Updated 12 min ago" under it scrolls with the list, and once it has gone under the status bar a 64dp bar on the
 * surface-container tone fades in with the title at 22sp and the subtitle at 12sp. Edge to edge, the status bar's strip
 * always carries the page tone or the bar's. iOS draws its large title natively (see TabStack), so every hook here is
 * inert there.
 */
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { Animated, Platform, Text, View, type NativeScrollEvent, type NativeSyntheticEvent, type ViewProps } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTokens } from '@/theme/tokens';

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
 * (the catch-up's indicator while something plays, task 0040 decision 6) and `a11y` on the pair.
 */
export function AppBarTitle({ subtitle, below = null, a11y = {} }: { subtitle: string | null; below?: ReactNode; a11y?: ViewProps }) {
  const frame = useContext(FrameContext);
  const insets = useSafeAreaInsets();
  const { c, type } = useTokens();
  const setSubtitle = frame?.setSubtitle;
  useEffect(() => {
    setSubtitle?.(subtitle);
  }, [setSubtitle, subtitle]);
  if (frame === null) return null;
  return (
    <View style={{ paddingTop: insets.top + TITLE_TOP, paddingHorizontal: type.gutter, paddingBottom: subtitle === null ? 16 : 12 }}>
      <Text accessibilityRole="header" numberOfLines={1} style={{ fontSize: type.viewTitle, lineHeight: TITLE_LINE, color: c.ink }}>{frame.title}</Text>
      {subtitle === null ? null : (
        <View {...a11y} style={{ gap: 8 }}>
          <Text numberOfLines={1} style={{ fontSize: type.sub, lineHeight: 20, color: c.sub }}>{subtitle}</Text>
          {below}
        </View>
      )}
    </View>
  );
}

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
        <Text numberOfLines={1} style={{ fontSize: 22, lineHeight: 28, color: c.ink }}>{frame?.title}</Text>
        {frame?.subtitle ? <Text numberOfLines={1} style={{ fontSize: 12, lineHeight: 16, color: c.sub }}>{frame.subtitle}</Text> : null}
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

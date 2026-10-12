/**
 * What floats on the bottom edge of a tab's safe area, top to bottom as DESIGN-UI section 11 stacks it: the notice line
 * (section 12), then the mini player where the iOS 26 tab bar's accessory is not carrying it (task 0036 decision 5).
 * The catch-up lives in the header (task 0040, decision 8). Lists pad past it with `useDockClearance()`.
 * On New releases (`filter`), where the tab bar has no place for the filter, the mini player shares one row with the
 * filter circle, 8 above the bar with 16 margins: card + 8 + circle = the row, the circle alone at the right with
 * nothing playing; under the row the list fades out into the page, decision 3's scroll edge drawn by hand (task 0071,
 * decisions 3 and 5, the author's Open 1 answer: Android's native bar stays, full width, and this row floats over it).
 */
import { usePathname } from 'expo-router';
import { createContext, useContext, useState, type ReactNode } from 'react';
import { Platform, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { FilterCircle } from '@/components/filter/FilterCircle';
import { FILTERS_ROUTE } from '@/components/filter/useFilterToggle';
import { Notice } from '@/components/Notice';
import { useTokens } from '@/theme/tokens';

import { MiniPlayer, playerInAccessory } from './MiniPlayer';

const GAP = Platform.OS === 'ios' ? 8 : 12;
/** The filter row's distance above the bar (task 0071, decision 3). */
const ROW_GAP = 8;
/**
 * CSS4's `.edgefade` over the part of the screen above the bar: 194 tall from the screen's foot on Android, of which
 * the bar takes 88, clear at its top, 80 percent at 22 percent of it and solid from 40 percent.
 */
const FADE = { height: 106, mid: 43 / 106, solid: 78 / 106 };

const Clearance = createContext(0);

export function useDockClearance(): number {
  return useContext(Clearance);
}

function withAlpha(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1, 7), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

export function WithDock({ children, filter = false }: { children: ReactNode; filter?: boolean }) {
  const { c } = useTokens();
  const insets = useSafeAreaInsets();
  const [height, setHeight] = useState(0);
  const accessory = playerInAccessory();
  const pathname = usePathname();
  // The list itself, and under its open sheet; a screen pushed over the list keeps the mini player as it was.
  const row = filter && !accessory && (pathname === '/releases' || pathname === FILTERS_ROUTE);
  const gap = row ? ROW_GAP : GAP;
  const bottom = Platform.OS === 'ios' ? insets.bottom + gap : gap;
  return (
    <Clearance value={height ? height + gap : 0}>
      <View style={{ flex: 1 }}>
        {children}
        {row ? (
          <View
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              bottom: 0,
              height: FADE.height + (Platform.OS === 'ios' ? insets.bottom : 0),
              pointerEvents: 'none',
              experimental_backgroundImage: `linear-gradient(to bottom, ${withAlpha(c.bg, 0)} 0%, ${withAlpha(c.bg, 0.8)} ${Math.round(FADE.mid * 100)}%, ${c.bg} ${Math.round(FADE.solid * 100)}%)`,
            }}
          />
        ) : null}
        <View onLayout={(e) => setHeight(e.nativeEvent.layout.height)} style={{ position: 'absolute', left: 0, right: 0, bottom, gap: GAP, pointerEvents: 'box-none' }}>
          <Notice />
          {row ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 8, paddingHorizontal: 16, pointerEvents: 'box-none' }}>
              <MiniPlayer beside />
              <FilterCircle />
            </View>
          ) : accessory ? null : (
            <MiniPlayer />
          )}
        </View>
      </View>
    </Clearance>
  );
}

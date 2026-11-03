/**
 * What floats on the bottom edge of a tab's safe area, top to bottom as DESIGN-UI section 11 stacks it: the notice line
 * (section 12), then the mini player where the iOS 26 tab bar's accessory is not carrying it.
 * The catch-up lives in the header. Lists pad past it with `useDockClearance()`. On New
 * releases (`filter`) the filter button stands on top, 16 from the right edge and 16 above whatever sits under it: the
 * notice, the mini player, the iOS 26 bar's accessory or the bar; the
 * clearance takes it in, so the last row clears it. The tab bar itself never changes.
 */
import { createContext, useContext, useState, type ReactNode } from 'react';
import { Platform, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { FilterButton } from '@/components/filter/FilterButton';
import { Notice } from '@/components/Notice';

import { MiniPlayer, playerInAccessory } from './MiniPlayer';

const GAP = Platform.OS === 'ios' ? 8 : 12;
/** The filter button's distance above what sits under it. */
const BUTTON_GAP = 16;

const Clearance = createContext(0);

export function useDockClearance(): number {
  return useContext(Clearance);
}

export function WithDock({ children, filter = false }: { children: ReactNode; filter?: boolean }) {
  const insets = useSafeAreaInsets();
  const [height, setHeight] = useState(0);
  const bottom = Platform.OS === 'ios' ? insets.bottom + GAP : GAP;
  const accessory = playerInAccessory();
  return (
    <Clearance value={height ? height + GAP : 0}>
      <View style={{ flex: 1 }}>
        {children}
        <View onLayout={(e) => setHeight(e.nativeEvent.layout.height)} style={{ position: 'absolute', left: 0, right: 0, bottom, gap: GAP, pointerEvents: 'box-none' }}>
          {filter ? (
            <View style={{ marginBottom: BUTTON_GAP - GAP, pointerEvents: 'box-none' }}>
              <FilterButton />
            </View>
          ) : null}
          <Notice />
          {accessory ? null : <MiniPlayer />}
        </View>
      </View>
    </Clearance>
  );
}

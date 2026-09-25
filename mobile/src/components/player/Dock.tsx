/**
 * What floats on the bottom edge of a tab's safe area, top to bottom as DESIGN-UI section 11 stacks it: the notice line
 * (section 12), the catch-up strip, and the mini player, each where the iOS 26 tab bar's accessory is not carrying it
 * (task 0036 decision 5). Lists pad past it with `useDockClearance()`.
 */
import { createContext, useContext, useState, type ReactNode } from 'react';
import { Platform, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CatchUpStrip } from '@/components/CatchUp';
import { Notice } from '@/components/Notice';

import { MiniPlayer, playerInAccessory } from './MiniPlayer';
import { usePlayerRelease } from './playerState';

const GAP = Platform.OS === 'ios' ? 8 : 12;

const Clearance = createContext(0);

export function useDockClearance(): number {
  return useContext(Clearance);
}

export function WithDock({ children }: { children: ReactNode }) {
  const insets = useSafeAreaInsets();
  const [height, setHeight] = useState(0);
  const bottom = Platform.OS === 'ios' ? insets.bottom + GAP : GAP;
  const current = usePlayerRelease();
  const accessory = playerInAccessory();
  // The accessory holds the catch-up only until something plays; after that the strip carries it here.
  const strip = !accessory || current !== null;
  return (
    <Clearance value={height ? height + GAP : 0}>
      <View style={{ flex: 1 }}>
        {children}
        <View onLayout={(e) => setHeight(e.nativeEvent.layout.height)} style={{ position: 'absolute', left: 0, right: 0, bottom, gap: GAP, pointerEvents: 'box-none' }}>
          <Notice />
          {strip ? <CatchUpStrip /> : null}
          {accessory ? null : <MiniPlayer />}
        </View>
      </View>
    </Clearance>
  );
}

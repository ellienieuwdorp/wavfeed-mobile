/**
 * What floats on the bottom edge of a tab's safe area, top to bottom as DESIGN-UI section 11 stacks it: the notice line
 * (section 12), then the catch-up strip while nothing plays or the mini player once something does, each where the iOS
 * 26 tab bar's accessory is not carrying it (task 0036 decision 5). The strip and the mini player never stack: while
 * something plays the header carries the catch-up (task 0040, decision 6). Lists pad past it with `useDockClearance()`.
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
  // Once something plays, the header carries the catch-up on both platforms (task 0040, decision 6).
  const strip = !accessory && current === null;
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

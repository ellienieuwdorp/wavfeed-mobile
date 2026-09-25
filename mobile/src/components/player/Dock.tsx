/**
 * The notice line and, where it is not the tab bar's accessory, the mini player,
 * floating on the bottom edge of a tab's safe area (DESIGN-UI section 12, task
 * 0036 decision 5). Lists pad past it with `useDockClearance()`.
 */
import { createContext, useContext, useState, type ReactNode } from 'react';
import { Platform, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Notice } from '@/components/Notice';

import { MiniPlayer, playerInAccessory } from './MiniPlayer';

const GAP = Platform.OS === 'ios' ? 8 : 12;

const Clearance = createContext(0);

export function useDockClearance(): number {
  return useContext(Clearance);
}

export function WithDock({ children }: { children: ReactNode }) {
  const insets = useSafeAreaInsets();
  const [height, setHeight] = useState(0);
  const bottom = Platform.OS === 'ios' ? insets.bottom + GAP : GAP;
  return (
    <Clearance value={height ? height + GAP : 0}>
      <View style={{ flex: 1 }}>
        {children}
        <View onLayout={(e) => setHeight(e.nativeEvent.layout.height)} style={{ position: 'absolute', left: 0, right: 0, bottom, gap: GAP, pointerEvents: 'box-none' }}>
          <Notice />
          {playerInAccessory() ? null : <MiniPlayer />}
        </View>
      </View>
    </Clearance>
  );
}

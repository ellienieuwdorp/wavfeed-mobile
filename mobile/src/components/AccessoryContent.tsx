/**
 * What rides in the iOS 26 tab bar's bottom accessory (task 0036 decision 5, DESIGN-UI section 9): the mini player once
 * something has played, otherwise the catch-up capsule while the first walk runs; once the player takes the accessory,
 * the catch-up moves to the strip in the dock (see Dock). The system renders one copy per placement, so neither half
 * holds state of its own.
 */
import { NativeTabs } from 'expo-router/unstable-native-tabs';

import { AccessoryPlayer } from '@/components/player/MiniPlayer';
import { usePlayerRelease } from '@/components/player/playerState';

import { CatchUpCapsule } from './CatchUp';

export function AccessoryContent() {
  const placement = NativeTabs.BottomAccessory.usePlacement();
  const current = usePlayerRelease();
  return current ? <AccessoryPlayer /> : <CatchUpCapsule inline={placement === 'inline'} />;
}

/**
 * The filter circle's press, on iOS the tab bar's trailing item and on Android the circle beside the mini player (task
 * 0071, decision 5 and the Open 1 answer): on with the last settings or off, and the Filters sheet only when nothing
 * is saved yet (see `circlePress`). A press before the saved settings are read does nothing. Neither shows off New
 * releases (see the iOS tab layout and Dock).
 */
import { router } from 'expo-router';

import { circlePress, isActive } from '@/state/filterSettings';
import { useReleaseFilter } from '@/state/releaseFilter';

export const FILTERS_ROUTE = '/filters';

export function useFilterToggle(): { readonly on: boolean; readonly press: () => void } {
  const { loaded, settings, update } = useReleaseFilter();
  return {
    on: isActive(settings),
    press: () => {
      if (!loaded) return;
      const { next, openSheet } = circlePress(settings);
      update(next);
      if (openSheet) router.push(FILTERS_ROUTE);
    },
  };
}

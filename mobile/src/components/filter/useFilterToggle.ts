/**
 * The filter circle's press, on iOS the tab bar's trailing item and on Android the circle beside the mini player (task
 * 0071, decision 5 and the Open 1 answer): on with the last settings or off, and the Filters sheet only when nothing
 * is saved yet (see `circlePress`). A press before the saved settings are read does nothing. The iOS item stands on
 * every tab (see the iOS tab layout), so a press from Feed or Settings opens New releases and changes nothing.
 */
import { router, usePathname } from 'expo-router';

import { circlePress, isActive } from '@/state/filterSettings';
import { useReleaseFilter } from '@/state/releaseFilter';

export const FILTERS_ROUTE = '/filters';

/** New releases, its pushed Upcoming list and the open sheet: where the filter's effect is in view. */
function onReleases(pathname: string): boolean {
  return pathname === '/releases' || pathname.startsWith('/releases/') || pathname === FILTERS_ROUTE;
}

export function useFilterToggle(): { readonly on: boolean; readonly press: () => void; readonly pressFromBar: () => void } {
  const { loaded, settings, update } = useReleaseFilter();
  const pathname = usePathname();
  const press = () => {
    if (!loaded) return;
    const { next, openSheet } = circlePress(settings);
    update(next);
    if (openSheet) router.push(FILTERS_ROUTE);
  };
  return {
    on: isActive(settings),
    press,
    pressFromBar: () => {
      if (onReleases(pathname)) press();
      else router.navigate('/releases');
    },
  };
}

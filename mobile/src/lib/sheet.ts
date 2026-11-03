import { router } from 'expo-router';

/** Leaves a sheet: back to the screen that opened it, else to the tabs when a link opened the app on the sheet. */
export function closeSheet(): void {
  if (router.canGoBack()) router.back();
  else router.replace('/');
}

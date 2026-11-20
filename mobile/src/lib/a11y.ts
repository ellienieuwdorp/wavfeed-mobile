/**
 * The system's accessibility settings as live values, and the one way the app speaks a line it does not focus (the
 * phone app review, VIS-2 and VIS-14). Each setting is one store for the whole app: the first hook to subscribe starts
 * its one native read and one change listener, and every later hook reads the cached value synchronously, so a list of
 * a hundred rows costs one bridge call. iOS has no live regions, so VoiceOver hears an announcement queued behind what
 * it is already saying; Android hands the same line to TalkBack.
 */
import { useSyncExternalStore } from 'react';
import { AccessibilityInfo } from 'react-native';

export type LiveSetting = { readonly subscribe: (listener: () => void) => () => void; readonly get: () => boolean | null };

/**
 * A setting read once and kept current by `listen`, null until either answers; a change heard before the read resolves
 * wins over it. The native listener is never removed: one per setting, for the app's life.
 */
export function liveSetting(read: () => Promise<boolean>, listen: (set: (on: boolean) => void) => void): LiveSetting {
  let value: boolean | null = null;
  let started = false;
  const listeners = new Set<() => void>();
  const set = (on: boolean) => {
    if (on === value) return;
    value = on;
    for (const listener of listeners) listener();
  };
  return {
    subscribe(listener) {
      listeners.add(listener);
      if (!started) {
        started = true;
        listen(set);
        read().then(
          (on) => {
            if (value === null) set(on);
          },
          () => undefined,
        );
      }
      return () => {
        listeners.delete(listener);
      };
    },
    get: () => value,
  };
}

/** `seed` stands in until the first answer. */
export function useLiveSetting(setting: LiveSetting, seed: boolean): boolean {
  return useSyncExternalStore(setting.subscribe, setting.get) ?? seed;
}

const SCREEN_READER = liveSetting(
  () => AccessibilityInfo.isScreenReaderEnabled(),
  (set) => AccessibilityInfo.addEventListener('screenReaderChanged', set),
);

/** VoiceOver or TalkBack on. */
export function useScreenReader(): boolean {
  return useLiveSetting(SCREEN_READER, false);
}

/** On Android this is React Native's TYPE_ANNOUNCEMENT event, which API 36 deprecates and TalkBack 16 still speaks. */
export function announce(text: string): void {
  AccessibilityInfo.announceForAccessibilityWithOptions(text, { queue: true });
}

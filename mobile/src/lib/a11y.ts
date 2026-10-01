/**
 * The system's accessibility settings as live values, and the one way the app speaks a line it does not focus (the
 * phone app review, VIS-2 and VIS-14). iOS has no live regions, so VoiceOver hears an announcement queued behind what it
 * is already saying; Android hands the same line to TalkBack.
 */
import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

type Setting = { read: () => Promise<boolean>; event: 'reduceMotionChanged' | 'screenReaderChanged' };

/** A setting read once on mount and kept current by its change event. */
export function useAccessibilitySetting({ read, event }: Setting): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    let alive = true;
    void read().then((value) => {
      if (alive) setOn(value);
    });
    const subscription = AccessibilityInfo.addEventListener(event, setOn);
    return () => {
      alive = false;
      subscription.remove();
    };
  }, [read, event]);
  return on;
}

const SCREEN_READER: Setting = { read: () => AccessibilityInfo.isScreenReaderEnabled(), event: 'screenReaderChanged' };

/** VoiceOver or TalkBack on. */
export function useScreenReader(): boolean {
  return useAccessibilitySetting(SCREEN_READER);
}

export function announce(text: string): void {
  AccessibilityInfo.announceForAccessibilityWithOptions(text, { queue: true });
}

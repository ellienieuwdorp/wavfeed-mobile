/**
 * The heart's two haptics (DESIGN-UI section 12, ADR-0016 amendment 2026-10-02): a light impact when a press turns a
 * heart on, the error notification when a failed press puts it back. Feedback is never worth an error, so a native
 * module that throws or rejects is dropped here.
 */
import { ImpactFeedbackStyle, impactAsync, NotificationFeedbackType, notificationAsync } from 'expo-haptics';

function quietly(run: () => Promise<void>) {
  try {
    run().catch(() => undefined);
  } catch {
    // A missing native module throws before it returns a promise.
  }
}

export function turnedOnHaptic(): void {
  quietly(() => impactAsync(ImpactFeedbackStyle.Light));
}

export function failedHaptic(): void {
  quietly(() => notificationAsync(NotificationFeedbackType.Error));
}

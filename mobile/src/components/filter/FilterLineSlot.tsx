/**
 * The place the "Filtered by" pill (FilteredBy) shares with the line it replaces, kept apart from the pill so the app
 * bar can hold it without the pill's imports.
 */
import type { ReactNode } from 'react';
import { View } from 'react-native';

/** The pill's height on both platforms. */
export const PILL_HEIGHT = 32;

/**
 * The place under New releases' title that the count line and the pill take in turn, holding the pill's height whichever
 * is drawn, so a filter turning active or clear moves nothing under it (the author's request of 2026-10-15).
 * `strut`, the line as it reads, is laid out unseen and grows the place where a larger text size wraps the line past
 * the pill's height; what shows sits centred over it, so the line's words and the pill's share a middle and crossfade
 * in place (`FilterEaseLine`).
 */
export function FilterLineSlot({ strut, children }: { strut: ReactNode; children: ReactNode }) {
  return (
    <View style={{ minHeight: PILL_HEIGHT, justifyContent: 'center' }}>
      <View importantForAccessibility="no-hide-descendants" accessibilityElementsHidden style={{ opacity: 0, pointerEvents: 'none' }}>
        {strut}
      </View>
      <View style={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, justifyContent: 'center', pointerEvents: 'box-none' }}>{children}</View>
    </View>
  );
}

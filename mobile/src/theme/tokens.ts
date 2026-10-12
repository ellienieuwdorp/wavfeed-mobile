/**
 * Colour and type tokens for the phone app (DESIGN-UI sections 6 and 7). The
 * palettes live in palette.ts, free of React Native so their contrast is tested
 * (review VIS-3), and how far text grows with the system text size lives in
 * textSize.ts. Type sizes follow the v2 client canvas: SF on iOS, the system
 * Roboto on Android at Material's body-large and body-medium, no web font. A
 * pressed row takes the platform's own highlight.
 * The scheme is one store: Settings > Appearance's choice for the session over the
 * system's, read by every `useTokens` so a switch lands in one React commit, with the
 * tab host's native scheme set in that same commit (see the tabs layouts).
 */
import { useSyncExternalStore } from 'react';
import { Appearance, Platform, PlatformColor, type ColorValue } from 'react-native';

import { dark, light, type Palette } from './palette';

export { dark, light, type Palette };

const ios = Platform.OS === 'ios';

export const type = {
  rowTitle: ios ? 15 : 16,
  fact: ios ? 13 : 14,
  sectionHead: ios ? 15 : 14,
  moduleHead: ios ? 20 : 18,
  viewTitle: ios ? 32 : 28,
  sub: ios ? 13 : 14,
  body: 16,
  gutter: ios ? 20 : 16,
  /** Android's body-large line height; iOS keeps the font's own. */
  rowTitleLine: ios ? undefined : 24,
} as const;

/**
 * The three lines of a Release row and an Upcoming card (task 0071, decisions 10 and 14, the R5 canvas's CSS5): the day
 * in small caps, the title and the credit line. Android takes Roboto's sizes and a lighter weight.
 */
export const rowText = {
  eyebrow: { fontSize: 11, lineHeight: ios ? 14 : 16, fontWeight: ios ? '600' : '500', letterSpacing: 0.55, textTransform: 'uppercase' },
  title: { fontSize: ios ? 15 : 16, lineHeight: ios ? 20 : 22, fontWeight: ios ? '600' : '500' },
  /** A card's title keeps 15 on Android, at the card's weight. */
  cardTitle: { fontSize: 15, lineHeight: 20, fontWeight: ios ? '600' : '500' },
  credit: { fontSize: ios ? 13 : 14, lineHeight: ios ? 18 : 20 },
} as const;

/** A Material state layer's ripple for a bounded surface, or for an icon button's 40dp circle when `radius` is given. */
export function ripple(colour: string, radius?: number) {
  return radius === undefined ? { color: colour, foreground: true } : { color: colour, borderless: true, radius };
}

/** A pressed row's fill: the system grey flash on iOS; Android draws the ripple instead. */
export const PRESS_FLASH: ColorValue | undefined = ios ? PlatformColor('systemGray4') : undefined;
/**
 * Words on iOS glass (task 0040, decision 7): the system's label colours, which follow the theme and what the glass
 * sits over. Null on Android.
 */
export const ON_GLASS: { ink: ColorValue; sub: ColorValue } | null = ios ? { ink: PlatformColor('label'), sub: PlatformColor('secondaryLabel') } : null;
/** A pressed control's opacity on iOS, UIKit's highlighted button; Android shows the ripple and keeps its opacity. */
export const PRESS_DIM = 0.5;

/** `base` times the iOS press dim, for a Pressable's style function; `base` carries a disabled or dead control's fade. */
export function pressedOpacity(pressed: boolean, base = 1): number {
  return (ios && pressed ? PRESS_DIM : 1) * base;
}

/** How long a row in a scrolling list waits before it lights, so a drag that starts on it scrolls without a flash. */
export const SCROLL_PRESS_DELAY_MS = 120;

/** Where Material's full-height sheet stops below the status bar, so a sheet taller than the window is capped there. */
export const SHEET_TOP = 24;

export type Tokens = { dark: boolean; c: Palette; type: typeof type };

export type AppearanceChoice = 'light' | 'dark' | 'system';

let choice: AppearanceChoice = 'system';
const choiceListeners = new Set<() => void>();

function subscribeChoice(listener: () => void): () => void {
  choiceListeners.add(listener);
  return () => {
    choiceListeners.delete(listener);
  };
}

function subscribeScheme(listener: () => void): () => void {
  const system = Appearance.addChangeListener(listener);
  const unsubscribe = subscribeChoice(listener);
  return () => {
    system.remove();
    unsubscribe();
  };
}

function readDark(): boolean {
  return (choice === 'system' ? Appearance.getColorScheme() : choice) === 'dark';
}

/**
 * Settings > Appearance, for the session. React Native's `Appearance.setColorScheme` sets the window's override at once
 * but tells JS only when the native change event comes back, so a light or dark pick is published here first and every
 * `useTokens` re-renders in one commit. "System" waits for that event, since the window's override hides the system's
 * own scheme until it is lifted.
 */
export function setAppearance(next: AppearanceChoice): void {
  if (next === choice) return;
  choice = next;
  Appearance.setColorScheme(next === 'system' ? 'unspecified' : next);
  for (const listener of choiceListeners) listener();
}

export function useAppearanceChoice(): AppearanceChoice {
  return useSyncExternalStore(subscribeChoice, () => choice);
}

export function useTokens(): Tokens {
  const isDark = useSyncExternalStore(subscribeScheme, readDark);
  return { dark: isDark, c: isDark ? dark : light, type };
}

export function artColour(hue: number): string {
  return `hsl(${hue}, 45%, 45%)`;
}

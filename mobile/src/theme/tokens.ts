/**
 * Colour and type tokens for the phone app (DESIGN-UI sections 6 and 7). React
 * Native has no oklch, so every colour is an sRGB hex approximation of the oklch
 * value in DESIGN-UI section 6; `online` is the canvas's signed-in dot and
 * `track` its segmented-control track (ink at 8 percent). Type sizes follow the
 * v2 client canvas: SF on iOS, the system Roboto on Android at Material's body-large
 * and body-medium, no web font. A pressed row takes the platform's own highlight.
 * The scheme is one store: Settings > Appearance's choice for the session over the
 * system's, read by every `useTokens` so a switch lands in one React commit, with the
 * tab host's native scheme set in that same commit (see the tabs layouts).
 */
import { useSyncExternalStore } from 'react';
import { Appearance, Platform, PlatformColor, type ColorValue } from 'react-native';

export type Palette = {
  bg: string;
  surface: string;
  raised: string;
  border: string;
  borderLight: string;
  ink: string;
  sub: string;
  faint: string;
  accent: string;
  tint: string;
  wishlist: string;
  danger: string;
  onAccent: string;
  avatarBg: string;
  avatarInk: string;
  online: string;
  track: string;
};

export const light: Palette = {
  bg: '#fafbfc',
  surface: '#ffffff',
  raised: '#f4f5f7',
  border: '#e3e5e9',
  borderLight: '#edeef1',
  ink: '#2a2d33',
  sub: '#66696f',
  faint: '#85888e',
  accent: '#0687f5',
  tint: '#e2ecfb',
  wishlist: '#ff9c00',
  danger: '#c8352a',
  onAccent: '#ffffff',
  avatarBg: '#cddcf3',
  avatarInk: '#2f4f86',
  online: '#43b966',
  track: '#2a2d3314',
};

export const dark: Palette = {
  bg: '#1e2024',
  surface: '#2b2e33',
  raised: '#232529',
  border: '#3b3f46',
  borderLight: '#33363c',
  ink: '#e6e7ea',
  sub: '#a9acb2',
  faint: '#9c9fa5',
  accent: '#66a8f4',
  tint: '#2b4a73',
  wishlist: '#ffab33',
  danger: '#f07a6a',
  onAccent: '#10203a',
  avatarBg: '#3f5a86',
  avatarInk: '#e3ecfa',
  online: '#43b966',
  track: '#e6e7ea14',
};

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
  /** Android's body-large and body-medium line heights; iOS keeps the font's own. */
  rowTitleLine: ios ? undefined : 24,
  factLine: ios ? undefined : 20,
} as const;

/** A Material state layer's ripple for a bounded surface, or for an icon button's 40dp circle when `radius` is given. */
export function ripple(colour: string, radius?: number) {
  return radius === undefined ? { color: colour, foreground: true } : { color: colour, borderless: true, radius };
}

/** A pressed row's fill: the system grey flash on iOS; Android draws the ripple instead. */
export const PRESS_FLASH: ColorValue | undefined = ios ? PlatformColor('systemGray4') : undefined;
/** A pressed control's opacity on iOS, UIKit's highlighted button; Android shows the ripple and keeps its opacity. */
export const PRESS_DIM = 0.5;

/** `base` times the iOS press dim, for a Pressable's style function; `base` carries a disabled or dead control's fade. */
export function pressedOpacity(pressed: boolean, base = 1): number {
  return (ios && pressed ? PRESS_DIM : 1) * base;
}

/** How long a row in a scrolling list waits before it lights, so a drag that starts on it scrolls without a flash. */
export const SCROLL_PRESS_DELAY_MS = 120;

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

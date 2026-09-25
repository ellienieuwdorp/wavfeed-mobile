/**
 * Colour and type tokens for the phone app (DESIGN-UI sections 6 and 7). React
 * Native has no oklch, so every colour is an sRGB hex approximation of the oklch
 * value in DESIGN-UI section 6; `online` is the canvas's signed-in dot and
 * `track` its segmented-control track (ink at 8 percent). Type sizes follow the
 * v2 client canvas: SF on iOS, Roboto on Android, no web font.
 */
import { Platform, useColorScheme } from 'react-native';

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
  sectionHead: 15,
  moduleHead: 20,
  upcomingHead: 20,
  viewTitle: ios ? 32 : 22,
  sub: ios ? 13 : 14,
  body: 16,
  gutter: ios ? 20 : 16,
} as const;

export type Tokens = { dark: boolean; c: Palette; type: typeof type };

export function useTokens(): Tokens {
  const isDark = useColorScheme() === 'dark';
  return { dark: isDark, c: isDark ? dark : light, type };
}

export function artColour(hue: number): string {
  return `hsl(${hue}, 45%, 45%)`;
}

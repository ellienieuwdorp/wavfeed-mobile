/**
 * The two palettes (DESIGN-UI section 6), free of React Native so their contrast is tested under node. Every colour is
 * an sRGB hex approximation of the oklch value there; `online` is the canvas's signed-in dot and `track` its
 * segmented-control track (ink at 8 percent). The Bandcamp hues, `accent` and `wishlist`, stay for marks and fills; the
 * text variants beside them pass WCAG 1.4.3 at 4.5:1 and the heart's edge passes 1.4.11 at 3:1 (review VIS-3, VIS-M2,
 * VIS-15, VIS-M5; palette.test.ts lists every pair).
 */
export type Palette = {
  bg: string;
  surface: string;
  raised: string;
  border: string;
  borderLight: string;
  ink: string;
  sub: string;
  faint: string;
  /** Bandcamp's link blue, for marks and fills under a glyph: the tab tint, play discs, sliders, bars. */
  accent: string;
  /** The accent as words, and the fill under `onAccent` words: links, "View more", filled buttons. */
  accentText: string;
  /** The action's colour on the inverse surface (`ink`), Material's inverse primary: the Android snackbar. */
  inverseAccent: string;
  tint: string;
  wishlist: string;
  /** The filled heart's rim in the wishlist hue, so the shape clears 3:1 on the page. */
  wishlistEdge: string;
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
  faint: '#6b6e74',
  accent: '#0687f5',
  accentText: '#0668c4',
  inverseAccent: '#66a8f4',
  tint: '#e2ecfb',
  wishlist: '#ff9c00',
  wishlistEdge: '#b86e00',
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
  faint: '#93969c',
  accent: '#66a8f4',
  accentText: '#66a8f4',
  inverseAccent: '#0663b8',
  tint: '#2b4a73',
  wishlist: '#ffab33',
  wishlistEdge: '#ffab33',
  danger: '#f07a6a',
  onAccent: '#10203a',
  avatarBg: '#3f5a86',
  avatarInk: '#e3ecfa',
  online: '#43b966',
  track: '#e6e7ea14',
};

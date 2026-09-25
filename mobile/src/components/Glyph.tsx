/**
 * Every interface glyph in each platform's own set (task 0036 decision 5, DESIGN-UI section 10 for the player's): an SF
 * Symbol on iOS and the Material Symbol on Android, both through expo-symbols, in a fixed `size` square so play turning
 * into pause moves nothing around it. The Ionicon is only the fallback where a symbol cannot draw. The heart is not a
 * glyph: it is Bandcamp's silhouette everywhere (DESIGN-UI section 12).
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { SymbolView, type SymbolWeight } from 'expo-symbols';
import type { ComponentProps } from 'react';
import { Platform } from 'react-native';
import type { SFSymbol } from 'sf-symbols-typescript';

type IonName = ComponentProps<typeof Ionicons>['name'];
type AndroidSymbol = NonNullable<Extract<ComponentProps<typeof SymbolView>['name'], object>['android']>;

export type GlyphName =
  | 'play'
  | 'pause'
  | 'previous'
  | 'next'
  | 'close'
  | 'dismiss'
  | 'chevron'
  | 'dropDown'
  | 'phone'
  | 'external';

const GLYPHS: Readonly<Record<GlyphName, { sf: SFSymbol; md: AndroidSymbol; ion: IonName }>> = {
  play: { sf: 'play.fill', md: 'play_arrow', ion: 'play' },
  pause: { sf: 'pause.fill', md: 'pause', ion: 'pause' },
  previous: { sf: 'backward.fill', md: 'skip_previous', ion: 'play-back' },
  next: { sf: 'forward.fill', md: 'skip_next', ion: 'play-forward' },
  close: { sf: 'chevron.down', md: 'keyboard_arrow_down', ion: 'chevron-down' },
  dismiss: { sf: 'xmark', md: 'close', ion: 'close' },
  chevron: { sf: 'chevron.right', md: 'chevron_right', ion: 'chevron-forward' },
  dropDown: { sf: 'chevron.up.chevron.down', md: 'arrow_drop_down', ion: 'caret-down' },
  phone: { sf: 'iphone', md: 'smartphone', ion: 'phone-portrait-outline' },
  external: { sf: 'arrow.up.right', md: 'open_in_new', ion: 'open-outline' },
};

type Props = { name: GlyphName; size: number; colour: string; weight?: SymbolWeight };

export function Glyph({ name, size, colour, weight = 'semibold' }: Props) {
  const glyph = GLYPHS[name];
  return (
    <SymbolView
      name={{ ios: glyph.sf, android: glyph.md }}
      size={size}
      tintColor={colour}
      weight={Platform.OS === 'ios' ? weight : undefined}
      resizeMode="scaleAspectFit"
      style={{ width: size, height: size }}
      fallback={<Ionicons name={glyph.ion} size={size} color={colour} />}
    />
  );
}

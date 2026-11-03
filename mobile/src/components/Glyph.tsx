/**
 * Every interface glyph in each platform's own set (DESIGN-UI section 10 for the player's): an SF
 * Symbol on iOS and the Material Symbol on Android, both through expo-symbols, in a fixed `size` square so play turning
 * into pause moves nothing around it. On Android expo-symbols draws the symbol as text in its font, which the font
 * scale grows past the square, so it is asked for at `size` over the scale (review VIS-1). That lands at `size` where
 * the scale is linear; Android 14 and later scale large text by less, so there a glyph above about 24dp draws a little
 * under its square at a large font scale, never past it. The Ionicon is only the fallback where a symbol cannot draw.
 * The heart is not a glyph: it is Bandcamp's silhouette everywhere (DESIGN-UI section 12).
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { SymbolView, type SymbolWeight } from 'expo-symbols';
import type { ComponentProps } from 'react';
import { Platform, useWindowDimensions } from 'react-native';
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
  | 'external'
  | 'copy'
  | 'copied'
  | 'filter'
  | 'people'
  | 'search'
  | 'minus'
  | 'plus'
  | 'boxOff'
  | 'boxOn'
  | 'expand';

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
  copy: { sf: 'doc.on.doc', md: 'content_copy', ion: 'copy-outline' },
  copied: { sf: 'checkmark', md: 'check', ion: 'checkmark' },
  // New releases' filter.
  filter: { sf: 'line.3.horizontal.decrease', md: 'filter_list', ion: 'filter' },
  people: { sf: 'person.2.fill', md: 'group', ion: 'people' },
  search: { sf: 'magnifyingglass', md: 'search', ion: 'search' },
  minus: { sf: 'minus', md: 'remove', ion: 'remove' },
  plus: { sf: 'plus', md: 'add', ion: 'add' },
  boxOff: { sf: 'square', md: 'check_box_outline_blank', ion: 'square-outline' },
  boxOn: { sf: 'checkmark.square.fill', md: 'check_box', ion: 'checkbox' },
  expand: { sf: 'chevron.down', md: 'keyboard_arrow_down', ion: 'chevron-down' },
};

type Props = { name: GlyphName; size: number; colour: string; weight?: SymbolWeight };

const ios = Platform.OS === 'ios';

export function Glyph({ name, size, colour, weight = 'semibold' }: Props) {
  const glyph = GLYPHS[name];
  const { fontScale } = useWindowDimensions();
  return (
    <SymbolView
      name={{ ios: glyph.sf, android: glyph.md }}
      size={ios ? size : size / fontScale}
      tintColor={colour}
      weight={ios ? weight : undefined}
      resizeMode="scaleAspectFit"
      style={{ width: size, height: size }}
      fallback={<Ionicons name={glyph.ion} size={size} color={colour} />}
    />
  );
}

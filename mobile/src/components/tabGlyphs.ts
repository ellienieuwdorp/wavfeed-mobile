/**
 * The Feed and New releases tab glyphs (task 0071, decision 2): the three crests and the calendar, a separate image for
 * the selected state, rendered by `scripts/tab-glyphs.mjs` and drawn as templates so each bar tints them. Settings keeps
 * the system gear. The filter's on state for the iOS bar's trailing item is drawn in colour, one image per scheme
 * (task 0071, decision 5 and the Open 1 answer).
 */
import type { ImageSourcePropType } from 'react-native';

type TabGlyph = { readonly default: ImageSourcePropType; readonly selected: ImageSourcePropType };

export const TAB_GLYPHS: { readonly feed: TabGlyph; readonly releases: TabGlyph } = {
  feed: { default: require('../../assets/tabs/feed.png'), selected: require('../../assets/tabs/feed-selected.png') },
  releases: { default: require('../../assets/tabs/releases.png'), selected: require('../../assets/tabs/releases-selected.png') },
};

export const FILTER_ON: { readonly light: ImageSourcePropType; readonly dark: ImageSourcePropType } = {
  light: require('../../assets/tabs/filter-on-light.png'),
  dark: require('../../assets/tabs/filter-on-dark.png'),
};

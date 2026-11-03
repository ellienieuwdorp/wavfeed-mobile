/**
 * The Feed and New releases tab glyphs: the three crests and the calendar, a separate image for
 * the selected state, rendered by `scripts/tab-glyphs.mjs` and drawn as templates so each bar tints them. Settings keeps
 * the system gear.
 */
import type { ImageSourcePropType } from 'react-native';

type TabGlyph = { readonly default: ImageSourcePropType; readonly selected: ImageSourcePropType };

export const TAB_GLYPHS: { readonly feed: TabGlyph; readonly releases: TabGlyph } = {
  feed: { default: require('../../assets/tabs/feed.png'), selected: require('../../assets/tabs/feed-selected.png') },
  releases: { default: require('../../assets/tabs/releases.png'), selected: require('../../assets/tabs/releases-selected.png') },
};

/**
 * What a heart wishlists and how its label names it, as Bandcamp's collect write takes it (ADR-0016). `releaseHeart` is
 * the Release itself, `a` and the album's id or `t` and a lone Track's id, and takes no Track, so the player sheet's art
 * heart never wishlists the Track playing in an album; `trackHeart` is one Track of a Release, `t` and that Track's id,
 * its write still naming the Release's Page, as each tracklist row's heart is. An album's heart names "the album", so a
 * title Track's row and the art read apart.
 */
import { storeItemType, type PlayableRelease } from '@/player/transport';

import { wishlistCopy } from './copy';
import type { WishlistTarget } from './exchange';

/** The item a heart acts on and the words its label names it by. */
export type HeartItem = { readonly target: WishlistTarget; readonly name: string };

type ReleaseFacts = { readonly itemType: PlayableRelease['itemType']; readonly itemId: string; readonly title: string };

export function releaseHeart(release: ReleaseFacts): HeartItem {
  const itemType = storeItemType(release.itemType);
  const own = { itemType, itemId: release.itemId };
  return { target: { ...own, release: own }, name: itemType === 'a' ? wishlistCopy.album(release.title) : release.title };
}

export function trackHeart(release: ReleaseFacts, track: { readonly trackId: string; readonly title: string }): HeartItem {
  const own = { itemType: storeItemType(release.itemType), itemId: release.itemId };
  return { target: { itemType: 't', itemId: track.trackId, release: own }, name: track.title };
}

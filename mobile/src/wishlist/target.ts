/**
 * What a heart wishlists, as Bandcamp's collect write names it (ADR-0016): the Release itself, `a` and the album's id
 * or `t` and a lone Track's id, or with `trackId` one Track of it, `t` and that Track's id, its write still naming the
 * Release's Page. The player sheet's art heart passes no Track, so it wishlists the Release and never the Track playing
 * in an album; its tracklist rows pass theirs (task 0071, the author's request of 2026-10-15).
 */
import { storeItemType, type PlayableRelease } from '@/player/transport';

import type { WishlistTarget } from './exchange';

export function heartTarget(itemType: PlayableRelease['itemType'], itemId: string, trackId?: string): WishlistTarget {
  const release = { itemType: storeItemType(itemType), itemId };
  return trackId === undefined ? { ...release, release } : { itemType: 't', itemId: trackId, release };
}

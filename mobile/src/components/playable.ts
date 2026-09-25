/**
 * The hand-off from a row to the player and the heart: a Release as the player lane's `PlayableRelease`, with the large
 * art and the hue its colour block falls back to.
 */
import { usePlayer, type PlayableRelease } from '@/components/player/playerState';
import type { ApiItemType } from '@/domain/apiTypes';
import { ART_SIZE_LARGE, hueFor, releaseArtUrl } from '@/lib/format';

export type RowRelease = {
  readonly itemType: ApiItemType;
  readonly itemId: string;
  readonly title: string;
  readonly artist: string;
  readonly itemUrl: string;
  readonly artId: string | null;
};

export function playableItemType(itemType: ApiItemType): PlayableRelease['itemType'] {
  return itemType === 'a' ? 'album' : 'track';
}

export function toPlayable(item: RowRelease): PlayableRelease {
  return {
    itemType: playableItemType(item.itemType),
    itemId: item.itemId,
    title: item.title,
    artist: item.artist,
    url: item.itemUrl,
    artUrl: releaseArtUrl(item.artId, ART_SIZE_LARGE),
    hue: hueFor(item.itemId),
  };
}

export function usePlay(): (item: RowRelease) => void {
  const { play } = usePlayer();
  return (item) => play(toPlayable(item));
}

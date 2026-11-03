/**
 * The hand-off from a row to the player and the heart: a Release as the player lane's `PlayableRelease`, with the large
 * art and the hue its colour block falls back to.
 */
import { usePlayerActions } from '@/components/player/playerState';
import type { PlayableRelease } from '@/player/transport';
import type { ItemType } from '@/domain/types';
import { creditLine, type CreditLine } from '@/domain/credit';
import { hueFor, releaseArtUrl } from '@/lib/format';

export type RowRelease = {
  readonly itemType: ItemType;
  readonly itemId: string;
  readonly title: string;
  /** The Page's name, which for a label's Page is not the artist. */
  readonly pageName: string;
  /** The feed's band_name, else the release page's tralbum.artist; null when neither credited anyone. */
  readonly artistCredit: string | null;
  readonly itemUrl: string;
  readonly artId: string | null;
  /** Null is self-released, absent is not known, as the player reads them. */
  readonly label?: string | null | undefined;
  readonly releaseDate?: string | null | undefined;
};

export function playableItemType(itemType: ItemType): PlayableRelease['itemType'] {
  return itemType === 'a' ? 'album' : 'track';
}

/** The credit line's two names for a Release. */
export function creditOf(item: RowRelease): CreditLine {
  return creditLine({ pageName: item.pageName, artistCredit: item.artistCredit, label: item.label ?? null });
}

/** The name a row, the spoken row and the player call the artist: the credit, else the Page's name. */
export function artistOf(item: RowRelease): string {
  return creditOf(item).artist;
}

export function toPlayable(item: RowRelease): PlayableRelease {
  return {
    itemType: playableItemType(item.itemType),
    itemId: item.itemId,
    title: item.title,
    artist: artistOf(item),
    url: item.itemUrl,
    artUrl: releaseArtUrl(item.artId),
    hue: hueFor(item.itemId),
    label: item.label,
    releaseDate: item.releaseDate,
  };
}

/** `from` is the Track to start at, a Drop's newest; the transport falls back to the first that streams. */
export function usePlay(): (item: RowRelease, from?: string | null) => void {
  const { play } = usePlayerActions();
  return (item, from) => play(toPlayable(item), from);
}

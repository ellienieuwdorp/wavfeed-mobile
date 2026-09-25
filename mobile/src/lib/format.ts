/**
 * Bandcamp image addresses, avatar initials and the colour a Release falls back to, ported from
 * server/apps/web/src/lib/format.ts (task 0036, decision 3). The words live in `copy.ts`.
 */
import type { ApiFanRef } from '@/domain/apiTypes';

export const ART_SIZE_ROW = 3;
export const ART_SIZE_LARGE = 16;

export function releaseArtUrl(artId: string | null, size: number = ART_SIZE_ROW): string | null {
  return artId === null ? null : `https://f4.bcbits.com/img/a${artId}_${size}.jpg`;
}

export function fanAvatarUrl(imageId: string | number | null): string | null {
  return imageId === null ? null : `https://f4.bcbits.com/img/${imageId}_42.jpg`;
}

export function fanInitials(name: string): string {
  const letters = name.replace(/[^a-z0-9]/gi, '').slice(0, 2);
  return letters === '' ? '?' : letters.toLowerCase();
}

export function fanAvatarInitials(fan: Pick<ApiFanRef, 'name' | 'username'>): string {
  const name = fan.name === null ? '' : fan.name.trim();
  const initials = name === '' ? '?' : fanInitials(name);
  return initials === '?' ? fanInitials(fan.username) : initials;
}

/** A stable hue per Release for the colour block drawn while its art loads or when it has none. */
export function hueFor(itemId: string): number {
  let hash = 0;
  for (let i = 0; i < itemId.length; i += 1) hash = (hash * 31 + itemId.charCodeAt(i)) % 360;
  return hash;
}

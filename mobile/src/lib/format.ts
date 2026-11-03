/**
 * Bandcamp image addresses, avatar initials and the colour a Release falls back to. The words live in `copy.ts`. An image address carries
 * Bandcamp's size id after the underscore; `sizedImageUrl` swaps it for the smallest size that covers what the screen
 * draws (findings VIS-7, VIS-M3).
 */
import type { ApiFanRef } from '@/domain/apiTypes';

type Size = readonly [id: number, edge: number];

/**
 * Bandcamp's square sizes by id and edge in pixels, the same for art and a Fan's image, measured on 2026-10-01 with
 * cookie-free requests for public images. Art also comes square at 1200px as `_10`; a Fan's `_10` is the uncropped original.
 */
const FACE_LARGEST: Size = [16, 700];
const ART_LARGEST: Size = [10, 1200];
const SQUARE: readonly Size[] = [[42, 50], [3, 100], [7, 150], [9, 210], [2, 350], FACE_LARGEST];
const ART: readonly Size[] = [...SQUARE, ART_LARGEST];

const IMAGE_URL = /^(https:\/\/f4\.bcbits\.com\/img\/(a?)\d+)_\d+\.jpg$/;

/** Art at 700px: the size the lock screen gets, and the address a drawn cover resizes from. */
export function releaseArtUrl(artId: string | null): string | null {
  return artId === null ? null : `https://f4.bcbits.com/img/a${artId}_16.jpg`;
}

export function fanAvatarUrl(imageId: string | number | null): string | null {
  return imageId === null ? null : `https://f4.bcbits.com/img/${imageId}_42.jpg`;
}

/** A Bandcamp image at the smallest square size at least `pixels` wide, else its largest; any other address as given. */
export function sizedImageUrl(url: string, pixels: number): string {
  const match = IMAGE_URL.exec(url);
  if (match === null) return url;
  const [sizes, largest] = match[2] === 'a' ? [ART, ART_LARGEST] : [SQUARE, FACE_LARGEST];
  const [id] = sizes.find(([, edge]) => edge >= pixels) ?? largest;
  return `${match[1]}_${id}.jpg`;
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

/** A Fan's page on Bandcamp, their username as the path, as the web's lib/format.ts builds it (ADR-0009). */
export function fanPageUrl(fan: Pick<ApiFanRef, 'username'>): string {
  return `https://bandcamp.com/${encodeURIComponent(fan.username)}`;
}

/** Only an https address from the wire leaves the app for the browser or the share sheet. */
export function webUrl(url: string): string | null {
  return /^https:\/\/[^\s/]+/i.test(url) ? url : null;
}

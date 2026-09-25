/**
 * The pure half of the player (DESIGN-UI section 10, ADR-0015, task 0036): what a press on a row hands over, where the
 * transport may go inside one Release (ported from the web's trackNav.ts), and the tracklist a play starts from. The
 * tracklist comes off the newest stored release page while that page is young enough, else a fresh page fetch that
 * lands through `putRaw` before it is read back (ADR-0004). No cookie goes near it: the page fetch is public.
 */
import type { AudioMetadata } from 'expo-audio';
import type { SQLiteDatabase } from 'expo-sqlite';

import type { BandcampSession } from '@/bandcamp/session';
import type { BandcampDocument } from '@/bandcamp/wire';
import type { ApiReleaseTrack, ApiReleaseTracksResponse } from '@/domain/apiTypes';
import type { ItemType } from '@/domain/types';
import { readTracklist } from '@/store/queries';

export type PlayableRelease = {
  itemType: 'album' | 'track';
  itemId: string;
  title: string;
  artist: string;
  url: string;
  artUrl: string | null;
  hue: number;
  /** The label as the row that pressed play held it; null is self-released, absent is not known. */
  label?: string | null | undefined;
  /** The release day as the row held it, an ISO string read with `releaseDay`; absent or null is not known. */
  releaseDate?: string | null | undefined;
};

export type PlayerStatus = 'idle' | 'loading' | 'ready' | 'unplayable' | 'error';

export type TransportDeps = {
  readonly db: SQLiteDatabase;
  readonly session: BandcampSession;
  readonly putRaw: (doc: BandcampDocument) => Promise<{ deduped: boolean }>;
};

/** ADR-0015: a stored page is reused under 18 hours old, which leaves at least 6 hours of signature on its URLs. */
export const TRACKLIST_REUSE_MS = 18 * 60 * 60_000;

/** Reads the first letter, so a caller still handing over the store's own 'a' or 't' keys the same item. */
export function storeItemType(itemType: PlayableRelease['itemType']): ItemType {
  return itemType.charAt(0) === 'a' ? 'a' : 't';
}

export function isSameRelease(a: PlayableRelease, b: PlayableRelease): boolean {
  return a.itemType === b.itemType && a.itemId === b.itemId;
}

export function isStreamable(track: ApiReleaseTrack): boolean {
  return track.streamUrl !== null;
}

export function firstStreamableIndex(tracks: readonly ApiReleaseTrack[]): number | null {
  const index = tracks.findIndex(isStreamable);
  return index === -1 ? null : index;
}

export function nextStreamableIndex(tracks: readonly ApiReleaseTrack[], from: number): number | null {
  for (let index = from + 1; index < tracks.length; index += 1) {
    const track = tracks[index];
    if (track !== undefined && isStreamable(track)) return index;
  }
  return null;
}

export function previousStreamableIndex(tracks: readonly ApiReleaseTrack[], from: number): number | null {
  for (let index = Math.min(from, tracks.length) - 1; index >= 0; index -= 1) {
    const track = tracks[index];
    if (track !== undefined && isStreamable(track)) return index;
  }
  return null;
}

function youngerThan(tracklist: ApiReleaseTracksResponse, ms: number): boolean {
  return Date.now() - Date.parse(tracklist.fetchedAt) < ms;
}

/** Null when nothing can be had; `force` skips the stored page, and a failed fetch falls back to unexpired URLs. */
export async function loadTracklist(
  deps: TransportDeps,
  release: PlayableRelease,
  force: boolean,
): Promise<ApiReleaseTracksResponse | null> {
  const itemType = storeItemType(release.itemType);
  const itemId = Number(release.itemId);
  if (!Number.isSafeInteger(itemId)) return null;
  const held = await readTracklist(deps.db, itemType, itemId);
  if (held !== null && !force && youngerThan(held, TRACKLIST_REUSE_MS)) return held;

  const answer = await deps.session.fetchReleasePage(release.url, { itemType, itemId });
  if (answer.kind === 'ok' && answer.value.kind === 'page') {
    await deps.putRaw(answer.value.document);
    const fetched = await readTracklist(deps.db, itemType, itemId);
    if (fetched !== null) return fetched;
  }
  return held !== null && Date.now() < Date.parse(held.expiresAt) ? held : null;
}

export function lockScreenMetadata(release: PlayableRelease, track: ApiReleaseTrack): AudioMetadata {
  return {
    title: track.title,
    artist: release.artist,
    albumTitle: release.title,
    ...(release.artUrl === null ? {} : { artworkUrl: release.artUrl }),
  };
}

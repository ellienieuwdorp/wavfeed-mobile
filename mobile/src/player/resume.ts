/**
 * The last-played Release kept across launches: the Release,
 * the Track and the position within it, in the `kv` table under the Fan who played it, versioned so a change of shape
 * reads as nothing saved. A launch restores it paused, its tracklist read back off the stored release page, so the
 * iOS bar's accessory is there from the first frame; nothing is fetched and no audio is touched until the Fan presses
 * play. A Release the store no longer holds, a page that no longer reads, another Fan's save or a Release with no Track
 * that streams restores nothing.
 */
import type { SQLiteDatabase } from 'expo-sqlite';

import type { ApiReleaseTracksResponse } from '@/domain/apiTypes';
import { readKv, writeKv } from '@/store/kv';
import { readTracklist } from '@/store/queries';

import { firstStreamableIndex, isStreamable, storeItemType, type PlayableRelease } from './transport';

export const RESUME_KEY = 'player_resume';
const RESUME_VERSION = 1;
/** A position this close to a Track's end starts that Track over, since resuming there would end it at once. */
const RESUME_END_MARGIN_S = 2;

export type SavedPlayback = {
  readonly v: number;
  readonly fanId: number;
  readonly release: PlayableRelease;
  /** Null when the Release was at rest after its last Track. */
  readonly trackId: string | null;
  readonly position: number;
};

export type Resume = {
  readonly release: PlayableRelease;
  readonly tracklist: ApiReleaseTracksResponse;
  /** The Track to resume, null for a Release at rest, which a press starts from its first Track. */
  readonly index: number | null;
  readonly position: number;
};

/** Whole tenths of a second from 0, and 0 within `RESUME_END_MARGIN_S` of a known end or past it. */
function clampPosition(position: number, duration: number | null): number {
  if (!Number.isFinite(position) || position <= 0) return 0;
  if (duration !== null && duration > 0 && position >= duration - RESUME_END_MARGIN_S) return 0;
  return Math.round(position * 10) / 10;
}

export function savedPlayback(fanId: number, release: PlayableRelease, trackId: string | null, position: number): SavedPlayback {
  return { v: RESUME_VERSION, fanId, release, trackId, position: trackId === null ? 0 : clampPosition(position, null) };
}

export async function savePlayback(db: SQLiteDatabase, saved: SavedPlayback): Promise<void> {
  await writeKv(db, RESUME_KEY, saved);
}

function isText(value: unknown): value is string {
  return typeof value === 'string' && value !== '';
}

function readRelease(value: unknown): PlayableRelease | null {
  if (typeof value !== 'object' || value === null) return null;
  const r = value as Record<string, unknown>;
  if ((r.itemType !== 'album' && r.itemType !== 'track') || !isText(r.itemId) || !isText(r.url)) return null;
  if (typeof r.title !== 'string' || typeof r.artist !== 'string' || typeof r.hue !== 'number') return null;
  if (r.artUrl !== null && typeof r.artUrl !== 'string') return null;
  return {
    itemType: r.itemType,
    itemId: r.itemId,
    title: r.title,
    artist: r.artist,
    url: r.url,
    artUrl: r.artUrl,
    hue: r.hue,
    ...(r.label === null || typeof r.label === 'string' ? { label: r.label } : {}),
    ...(r.releaseDate === null || typeof r.releaseDate === 'string' ? { releaseDate: r.releaseDate } : {}),
  };
}

/** The save as written, or null for none, another version or a shape this build does not know. */
async function readSavedPlayback(db: SQLiteDatabase): Promise<SavedPlayback | null> {
  let value: unknown;
  try {
    value = await readKv<unknown>(db, RESUME_KEY);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null) return null;
  const saved = value as Record<string, unknown>;
  if (saved.v !== RESUME_VERSION || typeof saved.fanId !== 'number') return null;
  const release = readRelease(saved.release);
  if (release === null) return null;
  const trackId = saved.trackId === null || isText(saved.trackId) ? saved.trackId : undefined;
  if (trackId === undefined || typeof saved.position !== 'number') return null;
  return { v: RESUME_VERSION, fanId: saved.fanId, release, trackId, position: saved.position };
}

/**
 * What a launch restores for the Fan `fanId` (null: no Fan, nothing): the saved Release while the store still holds it
 * and its release page reads, at the saved Track while that Track streams, else at the first that does from its start.
 */
export async function loadResume(db: SQLiteDatabase, fanId: number | null): Promise<Resume | null> {
  if (fanId === null) return null;
  const saved = await readSavedPlayback(db);
  if (saved === null || saved.fanId !== fanId) return null;
  const itemType = storeItemType(saved.release.itemType);
  const itemId = Number(saved.release.itemId);
  if (!Number.isSafeInteger(itemId)) return null;
  const held = await db.getFirstAsync<{ held: number }>('select 1 as held from releases where item_type = ? and item_id = ?', [itemType, itemId]);
  if (held === null) return null;
  const tracklist = await readTracklist(db, itemType, itemId).catch(() => null);
  if (tracklist === null) return null;
  const first = firstStreamableIndex(tracklist.tracks);
  if (first === null) return null;
  if (saved.trackId === null) return { release: saved.release, tracklist, index: null, position: 0 };
  const index = tracklist.tracks.findIndex((track) => track.trackId === saved.trackId && isStreamable(track));
  if (index === -1) return { release: saved.release, tracklist, index: first, position: 0 };
  const duration = tracklist.tracks[index]?.duration ?? null;
  return { release: saved.release, tracklist, index, position: clampPosition(saved.position, duration) };
}

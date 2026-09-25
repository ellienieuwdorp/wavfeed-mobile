/**
 * The Tracks of a Release, read out of a stored release page's `data-tralbum` blob; stream URLs die 24 hours after the fetch (ADR-0015).
 * Ported from server/packages/bandcamp/src/tralbumTracks.ts (task 0036).
 */

export type TralbumTrack = {
  readonly trackId: string;
  readonly trackNum: number;
  readonly title: string;
  readonly duration: number | null;
  readonly streamUrl: string | null;
  readonly capped: boolean;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
}

/** Bandcamp writes these flags as `1`, `null` or `true`. */
function isSet(value: unknown): boolean {
  return value === true || (typeof value === 'number' && value !== 0);
}

function readId(value: unknown): string | null {
  if (typeof value === 'number' && Number.isSafeInteger(value)) return String(value);
  if (typeof value === 'string' && /^[0-9]{1,19}$/.test(value)) return value;
  return null;
}

/** Both halves are required: a pre-order can say `streaming` while carrying no file. */
function readStreamUrl(entry: Record<string, unknown>): string | null {
  if (!isSet(entry.streaming)) return null;
  const url = asRecord(entry.file)?.['mp3-128'];
  return typeof url === 'string' && url !== '' ? url : null;
}

/** Never throws: a bad entry is dropped and a bad blob is an empty tracklist. */
export function readTralbumTracks(tralbum: unknown): readonly TralbumTrack[] {
  const trackinfo = asRecord(tralbum)?.trackinfo;
  if (!Array.isArray(trackinfo)) return [];

  const tracks: TralbumTrack[] = [];
  for (const [index, value] of trackinfo.entries()) {
    const entry = asRecord(value);
    const trackId = entry === null ? null : readId(entry.id);
    if (entry === null || trackId === null) continue;
    const trackNum =
      typeof entry.track_num === 'number' && Number.isFinite(entry.track_num) ? Math.trunc(entry.track_num) : index + 1;
    tracks.push({
      trackId,
      trackNum,
      title: typeof entry.title === 'string' && entry.title !== '' ? entry.title : `Track ${trackNum}`,
      duration: typeof entry.duration === 'number' && Number.isFinite(entry.duration) ? entry.duration : null,
      streamUrl: readStreamUrl(entry),
      capped: isSet(entry.is_capped),
    });
  }
  return tracks.sort((left, right) => left.trackNum - right.trackNum);
}

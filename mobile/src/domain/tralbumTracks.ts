/**
 * The Tracks of a Release, read out of a stored release page's `data-tralbum` blob; stream URLs die 24 hours after the fetch (ADR-0015).
 * Every Track the page names is listed, those not out yet marked so (task 0041, decision 5).
 * Ported from server/packages/bandcamp/src/tralbumTracks.ts (task 0036).
 */

export type TralbumTrack = {
  readonly trackId: string;
  readonly trackNum: number;
  readonly title: string;
  readonly duration: number | null;
  readonly streamUrl: string | null;
  readonly capped: boolean;
  /** False for a Track the label has not let out yet: it has no file, and so no stream. */
  readonly out: boolean;
  /** `title_link`, the Track page's path on the Release's host; a Track not out has none (task 0041, decision 8). */
  readonly path: string | null;
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

/**
 * A Track not out says `unreleased_track`, has `id: null` with its id in `track_id`, and no file; on a pre-order a
 * Track with no file is not out either (task 0041, decision 5). An album page states `is_preorder`, a track page `album_is_preorder`.
 */
function isOut(entry: Record<string, unknown>, preorder: boolean, streamUrl: string | null): boolean {
  if (isSet(entry.unreleased_track)) return false;
  return streamUrl !== null || !preorder;
}

/** Never throws: a bad entry is dropped and a bad blob is an empty tracklist. */
export function readTralbumTracks(tralbum: unknown): readonly TralbumTrack[] {
  const blob = asRecord(tralbum);
  const trackinfo = blob?.trackinfo;
  if (!Array.isArray(trackinfo)) return [];
  const preorder = isSet(blob?.is_preorder) || isSet(blob?.album_is_preorder);

  const tracks: TralbumTrack[] = [];
  for (const [index, value] of trackinfo.entries()) {
    const entry = asRecord(value);
    const trackId = entry === null ? null : (readId(entry.id) ?? readId(entry.track_id));
    if (entry === null || trackId === null) continue;
    const trackNum =
      typeof entry.track_num === 'number' && Number.isFinite(entry.track_num) ? Math.trunc(entry.track_num) : index + 1;
    const file = readStreamUrl(entry);
    const out = isOut(entry, preorder, file);
    tracks.push({
      trackId,
      trackNum,
      title: typeof entry.title === 'string' && entry.title !== '' ? entry.title : `Track ${trackNum}`,
      duration: typeof entry.duration === 'number' && Number.isFinite(entry.duration) ? entry.duration : null,
      streamUrl: out ? file : null,
      capped: isSet(entry.is_capped),
      out,
      path: typeof entry.title_link === 'string' && entry.title_link.startsWith('/') ? entry.title_link : null,
    });
  }
  return tracks.sort((left, right) => left.trackNum - right.trackNum);
}

/**
 * The Tracks that play on the `after` blob and did not on `before`, in track order: the Tracks a Drop let out, whose
 * Track pages date it (task 0041, decisions 7 and 8). A Track plays when the page hands over its file (decision 4).
 */
export function newlyOutTracks(before: unknown, after: unknown): readonly TralbumTrack[] {
  const played = new Set(readTralbumTracks(before).flatMap((track) => (track.streamUrl === null ? [] : [track.trackId])));
  return readTralbumTracks(after).filter((track) => track.streamUrl !== null && !played.has(track.trackId));
}

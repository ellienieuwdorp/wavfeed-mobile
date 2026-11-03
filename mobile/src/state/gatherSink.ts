/**
 * The gather turn's sink over the phone's store: responses go verbatim into raw_documents
 * (ADR-0004), the walk and the gather state live in the kv table, and every change to the gather state is published to
 * the screen. The store books the band details sweep by tier from the discography it was handed (ADR-0017): the sink
 * keeps the last band details payload per Page from `putRaw` and hands it to the store's `markSwept`. A failed fold
 * is a coded Error Report. The launch's replay runs here too, since it changes what the gather
 * state should fetch next (review finding ARCH-3).
 */
import type { SQLiteDatabase } from 'expo-sqlite';

import type { Identity } from '@/bandcamp/wire';
import { BAND_DETAILS_ENDPOINT } from '@/domain/endpoints';
import type { SkippedCounts } from '@/domain/types';
import { asRecord } from '@/domain/wire';
import { EMPTY_GATHER_STATE, ForeignFanError, type GatherSink, type GatherState, type WalkState } from '@/fetcher/sink';
import { devLog } from '@/lib/devLog';
import { fanAvatarUrl } from '@/lib/format';
import {
  deleteKv,
  ensureProjectionVersion,
  feedAnswerSpans,
  fold,
  type FoldSummary,
  IDENTITY_KEY,
  insertRawDocument,
  markSwept,
  readFollowedBands,
  readKv,
  readSweepDue,
  type ReplayProgress,
  type StoredIdentity,
  writeKv,
} from '@/store';
import {
  markReleasePageAttempt,
  readOwedTrackPages,
  readReleaseDateCounts,
  readUndatedReleases,
  readUpcomingDue,
} from '@/store/enrichment';
import { PROJECTION_REBUILDING_KEY, PROJECTION_VERSION } from '@/store/projection';
import { reportCode } from '@/tally/errors';

export const WALK_KEY = 'walk';
export const GATHER_KEY = 'gather';
/** Epoch milliseconds of the first identity this store held, the device row's "added" date. */
export const DEVICE_ADDED_KEY = 'deviceAddedAt';

export type SinkDeps = {
  readonly db: SQLiteDatabase;
  readonly setGather: (state: GatherState) => void;
  readonly invalidate: () => void;
  /** Hears each fold's skipped counts, for `projection_skipped`. */
  readonly onFold?: (skipped: SkippedCounts) => void;
};

let tail: Promise<unknown> = Promise.resolve();

/** Gather state writes queue behind each other, so a Settings press and a running turn never interleave a read and a write. */
function serial<T>(work: () => Promise<T>): Promise<T> {
  const next = tail.then(work, work);
  tail = next.catch(() => undefined);
  return next;
}

async function readStoredGather(db: SQLiteDatabase): Promise<GatherState> {
  return { ...EMPTY_GATHER_STATE, ...((await readKv<Partial<GatherState>>(db, GATHER_KEY)) ?? {}) };
}

/** The stored gather state at launch, `phase` reset: a turn killed with the app is not running. */
export async function loadGatherState({ db, setGather }: SinkDeps): Promise<GatherState> {
  const state = { ...(await readStoredGather(db)), phase: 'idle' as const };
  setGather(state);
  return state;
}

export function patchGather({ db, setGather }: SinkDeps, patch: Partial<GatherState>): Promise<GatherState> {
  return serial(async () => {
    const next = { ...(await readStoredGather(db)), ...patch };
    await writeKv(db, GATHER_KEY, next);
    setGather(next);
    return next;
  });
}

/**
 * The launch drains pending observations or replays after a parser change (ADR-0004). A replay, or one that failed partway, leaves `wishlist_items`
 * without the heart presses `wishlist/state.ts` writes straight into it, so the wishlist is due on the next turn
 * (ARCH-3). A failed replay is a coded Error Report and resumes at the next launch; this never throws. Answers
 * whether it replayed.
 */
export async function replayAtLaunch(deps: SinkDeps, onProgress?: ReplayProgress): Promise<boolean> {
  let replayed = true;
  try {
    replayed = await ensureProjectionVersion(deps.db, onProgress);
  } catch (error) {
    // Only the durable rebuild marker means wishlist rows were emptied; a failed drain keeps them.
    replayed = (await readKv<number>(deps.db, PROJECTION_REBUILDING_KEY).catch(() => PROJECTION_VERSION)) !== null;
    console.warn('launch projection failed:', error instanceof Error ? error.message : String(error));
    reportCode('projection_replay_failed', error);
  }
  // A rebuild erased local confirmations, so its next automatic read must bypass the attempt gate too.
  if (replayed) await patchGather(deps, { wishlistFetchedAt: null, wishlistAskedAt: null }).catch(() => undefined);
  return replayed;
}

export function readStoredIdentity(db: SQLiteDatabase): Promise<StoredIdentity | null> {
  return readKv<StoredIdentity>(db, IDENTITY_KEY);
}

/** The probe's answer with the name and face the Projection holds for that Fan, if any; a missing handle keeps the last one. */
export async function writeIdentity(db: SQLiteDatabase, identity: Identity, nowMs: number): Promise<void> {
  const held = await readStoredIdentity(db);
  const same = held !== null && held.fanId === identity.fanId;
  const fan = await db.getFirstAsync<{ name: string | null; image_id: number | null }>(
    'select name, image_id from fans where fan_id = ?',
    [identity.fanId],
  );
  const stored: StoredIdentity = {
    fanId: identity.fanId,
    username: identity.username ?? (same ? held.username : ''),
    name: fan?.name ?? (same ? held.name : null),
    avatarUrl: fan?.image_id != null ? fanAvatarUrl(fan.image_id) : same ? held.avatarUrl : null,
  };
  await writeKv(db, IDENTITY_KEY, stored);
  if ((await readKv<number>(db, DEVICE_ADDED_KEY)) === null) await writeKv(db, DEVICE_ADDED_KEY, nowMs);
}

/** The stored walk; one stored before the depth probe lacks its fields and reads as not probed, with no floor. */
export async function readStoredWalk(db: SQLiteDatabase): Promise<WalkState | null> {
  const stored = await readKv<Partial<WalkState>>(db, WALK_KEY);
  return stored === null ? null : ({ probed: false, floor: null, probeOldest: [], ...stored } as WalkState);
}

export function createGatherSink(deps: SinkDeps): GatherSink {
  const { db, invalidate } = deps;
  const details = new Map<number, unknown>();

  return {
    async putRaw(doc) {
      const { deduped } = await insertRawDocument(db, doc);
      if (doc.endpoint === BAND_DETAILS_ENDPOINT) {
        const payload = asRecord(doc.payload);
        if (typeof payload?.bandId === 'number') details.set(payload.bandId, payload.bandDetails);
      }
      return { deduped };
    },
    readWalk: () => readStoredWalk(db),
    async readFeedSamples(sinceMs, below) {
      return (await feedAnswerSpans(db, new Date(sinceMs))).filter((span) => span.oldest < below);
    },
    writeWalk: (walk) => (walk === null ? deleteKv(db, WALK_KEY) : writeKv(db, WALK_KEY, walk)),
    async readGatherState() {
      const state = await readStoredGather(db);
      deps.setGather(state);
      return state;
    },
    async patchGatherState(patch) {
      if (patch.identity) {
        const held = await readStoredIdentity(db);
        // This store's feed belongs to the first Fan it held (the refusal line); another Fan gathers nothing here.
        if (held !== null && held.fanId !== patch.identity.fanId) {
          await patchGather(deps, { pausedReason: 'logged_out' });
          throw new ForeignFanError();
        }
        await writeIdentity(db, patch.identity, Date.now());
        invalidate();
      }
      await patchGather(deps, patch);
    },
    async readFollowedBands() {
      return (await readFollowedBands(db)).map((band) => ({ bandId: band.bandId, name: band.name ?? '' }));
    },
    async readSweepDue(nowMs, limit) {
      return (await readSweepDue(db, new Date(nowMs), limit)).map((due) => ({ bandId: due.bandId }));
    },
    async markSwept(bandId, nowMs, ok) {
      const at = new Date(nowMs);
      if (!ok) {
        await markSwept(db, { bandId, at, outcome: 'failed' });
        return;
      }
      // The turn books a read discography or a 404/410 as ok; only the first reached `putRaw` with a payload.
      if (details.has(bandId)) {
        const bandDetails = details.get(bandId);
        details.delete(bandId);
        await markSwept(db, { bandId, at, outcome: 'swept', bandDetails });
      } else {
        await markSwept(db, { bandId, at, outcome: 'gone' });
      }
    },
    async afterDocuments() {
      let summary: FoldSummary;
      try {
        summary = await fold(db);
        if (__DEV__) devLog('fold:', summary.documentsProcessed, 'documents,', summary.storiesUpserted ?? 0, 'stories, skipped', JSON.stringify(summary.skipped));
      } catch (error) {
        console.warn('fold failed:', error instanceof Error ? error.message : String(error));
        reportCode('fold_failed', error);
        throw error;
      }
      deps.onFold?.(summary.skipped);
      invalidate();
    },
    readUndatedReleases: (nowMs, limit) => readUndatedReleases(db, limit, new Date(nowMs)),
    readUpcomingDue: (nowMs, limit, only) => readUpcomingDue(db, limit, new Date(nowMs), only),
    readOwedTrackPages: (nowMs, limit, albumId) => readOwedTrackPages(db, limit, new Date(nowMs), albumId),
    markReleasePageAttempt: (key, outcome, nowMs) => markReleasePageAttempt(db, key, outcome, new Date(nowMs)),
    readReleaseDateCounts: () => readReleaseDateCounts(db),
  };
}

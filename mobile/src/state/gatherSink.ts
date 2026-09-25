/**
 * The gather turn's sink over the phone's store (task 0036, decisions 2 and 4): responses go verbatim into raw_documents
 * (ADR-0004), the walk and the gather state live in the kv table, and every change to the gather state is published to
 * the screen. The store books the band details sweep by tier from the discography it was handed (ADR-0017), so the
 * turn's own `SweepBooking` is not stored: the sink keeps the last band details payload per Page from `putRaw` and
 * hands it to the store's `markSwept`.
 */
import type { SQLiteDatabase } from 'expo-sqlite';

import type { Identity } from '@/bandcamp/wire';
import { BAND_DETAILS_ENDPOINT } from '@/domain/endpoints';
import { asRecord } from '@/domain/wire';
import { EMPTY_GATHER_STATE, type GatherSink, type GatherState, type WalkState } from '@/fetcher/sink';
import { fanAvatarUrl } from '@/lib/format';
import {
  deleteKv,
  fold,
  IDENTITY_KEY,
  insertRawDocument,
  markSwept,
  readFollowedBands,
  readKv,
  readSweepDue,
  type StoredIdentity,
  writeKv,
} from '@/store';

export const WALK_KEY = 'walk';
export const GATHER_KEY = 'gather';
/** Set once the first launch has presented Connect Bandcamp by itself. */
export const CONNECT_SHOWN_KEY = 'connectShown';
/** Epoch milliseconds of the first identity this store held, the device row's "added" date. */
export const DEVICE_ADDED_KEY = 'deviceAddedAt';

/** Thrown from `patchGatherState` when the probe answers as a Fan this store does not belong to; the turn ends there. */
export class ForeignFanError extends Error {
  constructor() {
    super('a different Fan is signed in');
  }
}

export type SinkDeps = {
  readonly db: SQLiteDatabase;
  readonly setGather: (state: GatherState) => void;
  readonly invalidate: () => void;
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
    readWalk: () => readKv<WalkState>(db, WALK_KEY),
    writeWalk: (walk) => (walk === null ? deleteKv(db, WALK_KEY) : writeKv(db, WALK_KEY, walk)),
    async readGatherState() {
      const state = await readStoredGather(db);
      deps.setGather(state);
      return state;
    },
    async patchGatherState(patch) {
      if (patch.identity) {
        const held = await readStoredIdentity(db);
        // This store's feed belongs to the first Fan it held (task 0036, the refusal line); another Fan gathers nothing here.
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
      return (await readSweepDue(db, new Date(nowMs), limit)).map((due) => ({ bandId: due.bandId, failures: due.failures }));
    },
    async markSwept(bandId, nowMs, ok, _booking) {
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
      try {
        const summary = await fold(db);
        console.log('fold:', summary.documentsProcessed, 'documents,', summary.storiesUpserted ?? 0, 'stories, skipped', JSON.stringify(summary.skipped));
      } catch (error) {
        console.warn('fold failed:', error instanceof Error ? error.message : String(error));
        throw error;
      }
      invalidate();
    },
  };
}

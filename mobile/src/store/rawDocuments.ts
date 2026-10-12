/**
 * Immutable response bodies and their ordered observations (ADR-0004, task 0068): the feed stops at known bodies,
 * while a Page or Release returning to an earlier body is observed again. Physical raw ids retain provenance;
 * observation ids and read times drive projection and lookbacks.
 */
import type { SQLiteDatabase } from 'expo-sqlite';
import { FEED_UPDATES_ENDPOINT } from '../domain/endpoints';
import { sha256Hex } from '../domain/hash';
import type { ItemType } from '../domain/types';

export type RawDocument = {
  readonly id: number;
  readonly observationId: number;
  readonly endpoint: string;
  readonly payload: unknown;
  readonly fetchedAt: string;
};

export type RawDocumentInput = {
  readonly endpoint: string;
  readonly payload: unknown;
  readonly fetchedAt: string;
};

type RawDocumentRow = { id: number; observation_id: number; endpoint: string; payload: string; fetched_at: string };

function toRawDocument(row: RawDocumentRow): RawDocument {
  return { id: row.id, observationId: row.observation_id, endpoint: row.endpoint, payload: JSON.parse(row.payload) as unknown, fetchedAt: row.fetched_at };
}

function toIsoInstant(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error(`fetchedAt is not a date: ${value}`);
  return parsed.toISOString();
}

export async function insertRawDocument(
  db: SQLiteDatabase,
  input: RawDocumentInput,
): Promise<{ readonly id: number; readonly deduped: boolean }> {
  const payload: unknown = JSON.stringify(input.payload);
  if (typeof payload !== 'string') throw new Error('a Raw Document payload must be JSON');
  const hash = sha256Hex(payload);
  const fetchedAt = toIsoInstant(input.fetchedAt);
  const result = await db.runAsync(
    `insert into raw_documents (endpoint, payload, fetched_at, content_hash) values (?, ?, ?, ?)
     on conflict (endpoint, content_hash) do nothing`,
    [input.endpoint, payload, fetchedAt, hash],
  );
  if (result.changes > 0) return { id: result.lastInsertRowId, deduped: false };

  const held = await db.getFirstAsync<{ id: number }>(
    'select id from raw_documents where endpoint = ? and content_hash = ?',
    [input.endpoint, hash],
  );
  if (held === null) throw new Error('a deduped Raw Document is not held');
  // One statement compares and records under SQLite's write lock: concurrent confirmations cannot repeat the
  // same newest body. A known feed page still dedupes against history; only catalog sources are reobserved (0068).
  const observed = await db.runAsync(
    `insert into raw_document_observations (raw_document_id, endpoint, source_key, fetched_at)
     select r.id, r.endpoint, original.source_key, ?
     from raw_documents r
     join raw_document_observations original on original.id = (
       select min(id) from raw_document_observations where raw_document_id = r.id
     )
     where r.id = ? and original.source_key is not null
       and r.id <> (select raw_document_id from raw_document_observations
         where endpoint = r.endpoint and source_key = original.source_key order by id desc limit 1)`,
    [fetchedAt, held.id],
  );
  return { id: held.id, deduped: observed.changes === 0 };
}

const PAST_CURSOR = `from raw_document_observations o
     join raw_documents r on r.id = o.raw_document_id
     left join projection_observation_progress p on p.endpoint = o.endpoint
     where o.id > coalesce(p.last_observation_id, 0)`;

/** The next observations past each endpoint's cursor, in admission order across endpoints. */
export async function listForProjection(db: SQLiteDatabase, limit: number): Promise<readonly RawDocument[]> {
  const rows = await db.getAllAsync<RawDocumentRow>(
    `select r.id, o.id as observation_id, r.endpoint, r.payload, o.fetched_at
     ${PAST_CURSOR}
     order by o.id
     limit ?`,
    [limit],
  );
  return rows.map(toRawDocument);
}

/** How many observations wait past the cursors and are held, for a replay's progress. */
export async function countForProjection(db: SQLiteDatabase): Promise<{ readonly waiting: number; readonly held: number }> {
  const waiting = await db.getFirstAsync<{ n: number }>(`select count(*) as n ${PAST_CURSOR}`);
  const held = await db.getFirstAsync<{ n: number }>('select count(*) as n from raw_document_observations');
  return { waiting: waiting?.n ?? 0, held: held?.n ?? 0 };
}

/** The newest observed release page; `beforeId` bounds the observation order reached by the fold. */
export async function latestReleasePageDocument(
  db: SQLiteDatabase,
  itemType: ItemType,
  itemId: number,
  beforeId: number = Number.MAX_SAFE_INTEGER,
): Promise<RawDocument | null> {
  const row = await db.getFirstAsync<RawDocumentRow>(
    `select r.id, o.id as observation_id, r.endpoint, r.payload, o.fetched_at
     from raw_document_observations o join raw_documents r on r.id = o.raw_document_id
     where o.endpoint = 'release_page' and o.source_key = ?
       and o.id < ?
     order by o.fetched_at desc, o.id desc
     limit 1`,
    [`${itemType}:${itemId}`, beforeId],
  );
  return row === null ? null : toRawDocument(row);
}

/**
 * Each feed answer with entries fetched at or after `since`, as its payload states it: the newest and oldest Story
 * dates, unix seconds, and the number of entries. What a walk probed before task 0040's decision 5 reads its samples from.
 */
export async function feedAnswerSpans(
  db: SQLiteDatabase,
  since: Date,
): Promise<readonly { readonly newest: number; readonly oldest: number; readonly count: number }[]> {
  const rows = await db.getAllAsync<{ newest: unknown; oldest: unknown; count: unknown }>(
    `select json_extract(payload, '$.stories.newest_story_date') as newest,
            json_extract(payload, '$.stories.oldest_story_date') as oldest,
            json_array_length(payload, '$.stories.entries') as count
     from raw_documents
     where endpoint = ? and fetched_at >= ?
     order by id`,
    [FEED_UPDATES_ENDPOINT, since.toISOString()],
  );
  return rows.flatMap(({ newest, oldest, count }) =>
    typeof newest === 'number' && typeof oldest === 'number' && typeof count === 'number' && count > 0
      ? [{ newest, oldest, count }]
      : [],
  );
}

/** The "updated N min ago" line: the newest Raw Document, read off the raw side so a lagging fold cannot hide it. */
export async function lastFetchedAt(db: SQLiteDatabase): Promise<string | null> {
  const row = await db.getFirstAsync<{ fetched_at: string | null }>('select max(fetched_at) as fetched_at from raw_documents');
  return row?.fetched_at ?? null;
}

export async function countRawDocuments(db: SQLiteDatabase): Promise<number> {
  const row = await db.getFirstAsync<{ count: number }>('select count(*) as count from raw_documents');
  return row?.count ?? 0;
}

/**
 * Raw Documents on the phone: every Bandcamp response stored verbatim with its SHA-256 before any parsing, deduped by (endpoint, hash)
 * so the Fetcher's walk can stop at a page already held (task 0036, ADR-0004).
 */
import type { SQLiteDatabase } from 'expo-sqlite';
import { FEED_UPDATES_ENDPOINT } from '../domain/endpoints';
import { sha256Hex } from '../domain/hash';
import type { ItemType } from '../domain/types';

export type RawDocument = {
  readonly id: number;
  readonly endpoint: string;
  readonly payload: unknown;
  readonly fetchedAt: string;
};

export type RawDocumentInput = {
  readonly endpoint: string;
  readonly payload: unknown;
  readonly fetchedAt: string;
};

type RawDocumentRow = { id: number; endpoint: string; payload: string; fetched_at: string };

function toRawDocument(row: RawDocumentRow): RawDocument {
  return { id: row.id, endpoint: row.endpoint, payload: JSON.parse(row.payload) as unknown, fetchedAt: row.fetched_at };
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
  const result = await db.runAsync(
    `insert into raw_documents (endpoint, payload, fetched_at, content_hash) values (?, ?, ?, ?)
     on conflict (endpoint, content_hash) do nothing`,
    [input.endpoint, payload, toIsoInstant(input.fetchedAt), hash],
  );
  if (result.changes > 0) return { id: result.lastInsertRowId, deduped: false };

  const held = await db.getFirstAsync<{ id: number }>(
    'select id from raw_documents where endpoint = ? and content_hash = ?',
    [input.endpoint, hash],
  );
  if (held === null) throw new Error('a deduped Raw Document is not held');
  return { id: held.id, deduped: true };
}

/** The next documents past each endpoint's projection cursor, in fetch order across endpoints. */
export async function listForProjection(db: SQLiteDatabase, limit: number): Promise<readonly RawDocument[]> {
  const rows = await db.getAllAsync<RawDocumentRow>(
    `select r.id, r.endpoint, r.payload, r.fetched_at
     from raw_documents r
     left join projection_progress p on p.endpoint = r.endpoint
     where r.id > coalesce(p.last_raw_id, 0)
     order by r.id
     limit ?`,
    [limit],
  );
  return rows.map(toRawDocument);
}

/** The newest release page held for a Release; with `beforeId`, the newest the fold had reached before that document. */
export async function latestReleasePageDocument(
  db: SQLiteDatabase,
  itemType: ItemType,
  itemId: number,
  beforeId: number = Number.MAX_SAFE_INTEGER,
): Promise<RawDocument | null> {
  const row = await db.getFirstAsync<RawDocumentRow>(
    `select id, endpoint, payload, fetched_at from raw_documents
     where endpoint = 'release_page'
       and json_extract(payload, '$.itemType') = ?
       and json_extract(payload, '$.itemId') = ?
       and id < ?
     order by fetched_at desc, id desc
     limit 1`,
    [itemType, itemId, beforeId],
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

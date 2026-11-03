/**
 * Membership snapshots remove old rows only after every page projects readably in order (ADR-0017). The
 * proof is derived and replayable; unreadable pages and repeated cursors poison it until a rebuild retries it.
 */
import type { SQLiteDatabase } from 'expo-sqlite';

import { FOLLOWING_BANDS_ENDPOINT, WISHLIST_ITEMS_ENDPOINT } from '../domain/endpoints';
import { asCount, asRecord, readDate } from '../domain/wire';
import type { RawDocument } from './rawDocuments';

type Proof = { next_page: number; next_token: string | null; seen_tokens: string; invalid: number; complete: number };
type Context = { startedAt: string; root: Record<string, unknown> };

function snapshotContext(doc: RawDocument): Context | null {
  const key = doc.endpoint === FOLLOWING_BANDS_ENDPOINT ? 'snapshotStartedAt' : doc.endpoint === WISHLIST_ITEMS_ENDPOINT ? 'snapshot_started_at' : null;
  const root = asRecord(doc.payload);
  const at = key === null || root === undefined ? undefined : readDate(root, key);
  return root === undefined || at === undefined ? null : { root, startedAt: at.toISOString() };
}

function firstToken(endpoint: string, startedAt: string): string | null {
  return endpoint === WISHLIST_ITEMS_ENDPOINT ? `${Math.floor(Date.parse(startedAt) / 1000)}::a::` : null;
}

function token(value: unknown): value is string | null {
  return value === null || (typeof value === 'string' && value !== '');
}

/** Legacy wishlist pages already hold request cursors; following pages hold source-written ordinals. */
function pageOf(doc: RawDocument, context: Context, held: Proof, terminal: boolean) {
  const { root } = context;
  const wishlist = doc.endpoint === WISHLIST_ITEMS_ENDPOINT;
  const response = asRecord(wishlist ? root.response : root.followingBands);
  const sequence = asRecord(response?.following_bands);
  if (!wishlist && root.page === 1 && !Array.isArray(response?.items) && asCount(sequence?.item_count) === undefined) return null;
  const next = terminal ? null : response?.last_token ?? sequence?.last_token;
  const input = asRecord(root.request)?.older_than_token;
  if ('snapshotPage' in root) {
    const page = asRecord(root.snapshotPage);
    if (page === undefined || !Number.isSafeInteger(page.number) || (page.number as number) < 1 || !token(page.inputToken) || !token(page.nextToken)) return null;
    if (page.nextToken !== next || (wishlist ? page.inputToken !== input : page.number !== root.page)) return null;
    return { number: page.number as number, inputToken: page.inputToken, nextToken: page.nextToken };
  }
  if (wishlist) {
    if (typeof input !== 'string' || !token(next)) return null;
    return { number: input === firstToken(doc.endpoint, context.startedAt) ? 1 : held.next_page, inputToken: input, nextToken: next };
  }
  if (!Number.isSafeInteger(root.page) || (root.page as number) < 1 || !token(next)) return null;
  return { number: root.page as number, inputToken: root.page === 1 ? null : held.next_token, nextToken: next };
}

/** Called after a document's savepoint rolls back too, so quarantine never makes a broken snapshot look complete. */
export async function invalidateSnapshot(db: SQLiteDatabase, doc: RawDocument): Promise<void> {
  const context = snapshotContext(doc);
  if (context === null) return;
  await db.runAsync(
    `insert into projection_snapshots (endpoint, snapshot_started_at, invalid) values (?, ?, 1)
     on conflict (endpoint, snapshot_started_at) do update set invalid = 1`,
    [doc.endpoint, context.startedAt],
  );
}

/** Records this page in the fold transaction and answers whether it proved a safe destructive completion. */
export async function completeSnapshot(db: SQLiteDatabase, doc: RawDocument, terminal: boolean, skipped: number): Promise<boolean> {
  const context = snapshotContext(doc);
  if (context === null) return false;
  const held = (await db.getFirstAsync<Proof>(
    'select next_page, next_token, seen_tokens, invalid, complete from projection_snapshots where endpoint = ? and snapshot_started_at = ?',
    [doc.endpoint, context.startedAt],
  )) ?? { next_page: 1, next_token: firstToken(doc.endpoint, context.startedAt), seen_tokens: '[]', invalid: 0, complete: 0 };
  const page = pageOf(doc, context, held, terminal);
  const consumed = new Set(JSON.parse(held.seen_tokens) as string[]);
  const repeated = page?.inputToken != null && consumed.has(page.inputToken);
  if (page?.inputToken != null) consumed.add(page.inputToken);
  const invalid = held.invalid !== 0 || held.complete !== 0 || skipped > 0 || page === null
    || page.number !== held.next_page || page.inputToken !== held.next_token || repeated
    || (!terminal && (page.nextToken === null || consumed.has(page.nextToken)));
  await db.runAsync(
    `insert into projection_snapshots (endpoint, snapshot_started_at, next_page, next_token, seen_tokens, invalid, complete) values (?, ?, ?, ?, ?, ?, ?)
     on conflict (endpoint, snapshot_started_at) do update set
       next_page = excluded.next_page, next_token = excluded.next_token, seen_tokens = excluded.seen_tokens,
       invalid = excluded.invalid, complete = excluded.complete`,
    [doc.endpoint, context.startedAt, page === null ? held.next_page : page.number + 1, page?.nextToken ?? null, JSON.stringify([...consumed]), invalid ? 1 : 0, terminal && !invalid ? 1 : 0],
  );
  return terminal && !invalid;
}

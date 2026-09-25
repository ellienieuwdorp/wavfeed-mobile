/**
 * The phone's SQLite store: Raw Documents, the derived Projection tables under the server's names minus `user_id` and triage, and the
 * Fetcher's own state (task 0036, ADR-0004). Migrations are numbered, applied once each, and recorded in `schema_migrations`.
 */
import { openDatabaseAsync, type SQLiteDatabase } from 'expo-sqlite';

import { BUSY_TIMEOUT_MS, migrate } from './migrations';

export { BUSY_TIMEOUT_MS } from './migrations';

export type Store = { readonly db: SQLiteDatabase };

export const STORE_FILE = 'wavfeed.db';

export async function openStore(file: string = STORE_FILE): Promise<Store> {
  const db = await openDatabaseAsync(file);
  await db.execAsync(`pragma journal_mode = wal; pragma busy_timeout = ${BUSY_TIMEOUT_MS};`);
  await migrate(db);
  return { db };
}

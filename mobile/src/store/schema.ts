/**
 * The phone's SQLite store: Raw Documents, the derived Projection tables under the server's names minus `user_id` and triage, and the
 * Fetcher's own state (task 0036, ADR-0004). Migrations are numbered, applied once each, and recorded in `schema_migrations`.
 */
import { deleteDatabaseAsync, openDatabaseAsync, type SQLiteDatabase } from 'expo-sqlite';

import { BUSY_TIMEOUT_MS, migrate } from './migrations';

export { BUSY_TIMEOUT_MS } from './migrations';

export type Store = { readonly db: SQLiteDatabase };

export const STORE_FILE = 'wavfeed.db';

/**
 * A store that opens but will not migrate is closed again, so the failure screen's "Try again" starts clean. Under WAL,
 * `synchronous = normal` syncs at checkpoints, not at every commit, and stays durable across an app crash (review
 * finding TECH-M2); the launch replay commits on this connection (projection.ts).
 */
export async function openStore(file: string = STORE_FILE): Promise<Store> {
  const db = await openDatabaseAsync(file);
  try {
    await db.execAsync(`pragma journal_mode = wal; pragma synchronous = normal; pragma busy_timeout = ${BUSY_TIMEOUT_MS};`);
    await migrate(db);
  } catch (error) {
    await db.closeAsync().catch(() => undefined);
    throw error;
  }
  return { db };
}

/**
 * Deletes the store file, then the `-wal` and `-shm` beside it, which `deleteDatabaseAsync` leaves and a fresh file of
 * the same name would replay (review REL-4). Throws while a connection holds the file; a missing main file counts as
 * deleted, since an open that failed before creating it leaves none, and a missing sidecar is the usual case after a
 * clean close.
 */
export async function deleteStoreFile(file: string = STORE_FILE): Promise<void> {
  await deleteDatabaseAsync(file).catch((error: unknown) => {
    if (!storeFileMissing(error)) throw error;
  });
  for (const sidecar of ['-wal', '-shm']) await deleteDatabaseAsync(`${file}${sidecar}`).catch(() => undefined);
}

/**
 * expo-sqlite 57's not-found from `deleteDatabaseAsync`: Android's `DatabaseNotFoundException` takes the inferred code
 * `ERR_DATABASE_NOT_FOUND`, and iOS gives it the code its open-file and delete failures share, so only its cause
 * tells them apart. expo-modules-core writes that cause with its Swift origin in every build, as in
 * "DatabaseNotFoundException: Database <path> not found (at ExpoSQLite/SQLiteModule.swift:521)".
 */
function storeFileMissing(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const { code, message } = error as { code?: unknown; message?: unknown };
  if (code === 'ERR_DATABASE_NOT_FOUND') return true;
  return code === 'E_SQLITE_DELETE_DATABASE' && typeof message === 'string' && /\bDatabaseNotFoundException\b| not found$/m.test(message);
}

/** "Remove everything gathered" when the file will not go: every table emptied but the migration record. */
export async function emptyStore(db: SQLiteDatabase): Promise<void> {
  const tables = await db.getAllAsync<{ name: string }>(
    "select name from sqlite_master where type = 'table' and name not in ('schema_migrations') and name not like 'sqlite_%'",
  );
  for (const { name } of tables) await db.execAsync(`delete from "${name}"`);
}

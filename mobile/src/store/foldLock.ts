/**
 * The fold's transactions, counted (task 0038 decision 10). A fold writes on its own connection and holds
 * the write lock across awaits that need the JavaScript thread, so a `runSync` write on the main connection in that
 * window blocks the thread for the whole busy timeout and then fails. An Error Report waits in memory while one is
 * open and is written when the last closes (src/tally/errors.ts). The launch replay, which runs before any screen can
 * write, takes the main connection instead, so it opens no connection per transaction and commits at that
 * connection's `synchronous = normal` (review findings PERF-2 and TECH-M2, projection.ts).
 */
import type { SQLiteDatabase } from 'expo-sqlite';

type Task = Parameters<SQLiteDatabase['withExclusiveTransactionAsync']>[0];

/** `own` opens a connection for the transaction; `main` runs it on `db` itself, for when nothing else uses `db`. */
export type FoldConnection = 'own' | 'main';

let open = 0;
const freed = new Set<() => void>();

export function foldHoldsLock(): boolean {
  return open > 0;
}

/** `run` must not throw: it runs in the closing transaction's `finally`. */
export function onFoldLockFree(run: () => void): void {
  freed.add(run);
}

export async function withFoldLock(db: SQLiteDatabase, task: Task, connection: FoldConnection = 'own'): Promise<void> {
  open += 1;
  try {
    if (connection === 'main') await db.withTransactionAsync(() => task(db as Parameters<Task>[0]));
    else await db.withExclusiveTransactionAsync(task);
  } finally {
    open -= 1;
    if (open === 0) for (const run of freed) run();
  }
}

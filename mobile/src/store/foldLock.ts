/**
 * The fold's exclusive transactions, counted (task 0038 decision 10). A fold writes on its own connection and holds
 * the write lock across awaits that need the JavaScript thread, so a `runSync` write on the main connection in that
 * window blocks the thread for the whole busy timeout and then fails. An Error Report waits in memory while one is
 * open and is written when the last closes (src/tally/errors.ts).
 */
import type { SQLiteDatabase } from 'expo-sqlite';

type Task = Parameters<SQLiteDatabase['withExclusiveTransactionAsync']>[0];

let open = 0;
const freed = new Set<() => void>();

export function foldHoldsLock(): boolean {
  return open > 0;
}

/** `run` must not throw: it runs in the closing transaction's `finally`. */
export function onFoldLockFree(run: () => void): void {
  freed.add(run);
}

export async function withFoldLock(db: SQLiteDatabase, task: Task): Promise<void> {
  open += 1;
  try {
    await db.withExclusiveTransactionAsync(task);
  } finally {
    open -= 1;
    if (open === 0) for (const run of freed) run();
  }
}

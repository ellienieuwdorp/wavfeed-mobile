/**
 * Start over deletes a store file that may never have been created (review REL-4). The stand-in answers
 * `deleteDatabaseAsync` as expo-sqlite 57 does on each platform: it removes a named file, refuses an open one, and
 * rejects a missing one with the code and message expo-modules-core puts on the rejection.
 */
import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';

import { deleteStoreFile } from './schema';

/** What test/register.mjs's expo-sqlite stand-in calls for `deleteDatabaseAsync`. */
const native = globalThis as { __deleteDatabaseAsync?: (name: string) => Promise<void> };

function coded(code: string, message: string): Error {
  return Object.assign(new Error(message), { code });
}

const PLATFORMS = {
  // The iOS messages as an iOS 26 simulator gave them, Swift origins included (they are there in a release build too).
  ios: {
    missing: (name: string) =>
      coded(
        'E_SQLITE_DELETE_DATABASE',
        `FunctionCallException: Calling the 'deleteDatabaseAsync' function has failed (at ExpoModulesCore/AsyncFunctionDefinition.swift:123)\n→ Caused by: DatabaseNotFoundException: Database /SQLite/${name} not found (at ExpoSQLite/SQLiteModule.swift:521)`,
      ),
    open: (name: string) =>
      coded(
        'E_SQLITE_DELETE_DATABASE',
        `FunctionCallException: Calling the 'deleteDatabaseAsync' function has failed (at ExpoModulesCore/AsyncFunctionDefinition.swift:123)\n→ Caused by: DeleteDatabaseException: Unable to delete database /SQLite/${name} that is currently open. Close it prior to deletion (at ExpoSQLite/SQLiteModule.swift:512)`,
      ),
  },
  android: {
    missing: (name: string) =>
      coded('ERR_DATABASE_NOT_FOUND', `Call to function 'ExpoSQLite.deleteDatabaseAsync' has been rejected.\n→ Caused by: Database '/data/${name}' not found`),
    open: (name: string) =>
      coded(
        'ERR_DELETE_DATABASE',
        `Call to function 'ExpoSQLite.deleteDatabaseAsync' has been rejected.\n→ Caused by: Unable to delete database '/data/${name}' that is currently open. Close it prior to deletion.`,
      ),
  },
} as const;

/** A directory of named files, some held open, deleted through the stand-in; returns what is left. */
function disk(platform: keyof typeof PLATFORMS, files: string[], open: string[] = []): Set<string> {
  const left = new Set(files);
  native.__deleteDatabaseAsync = async (name) => {
    if (open.includes(name)) throw PLATFORMS[platform].open(name);
    if (!left.delete(name)) throw PLATFORMS[platform].missing(name);
  };
  return left;
}

afterEach(() => {
  delete native.__deleteDatabaseAsync;
});

for (const platform of ['ios', 'android'] as const) {
  describe(`deleting the store file on ${platform}`, () => {
    test('removes the file with its -wal and -shm', async () => {
      const left = disk(platform, ['wavfeed.db', 'wavfeed.db-wal', 'wavfeed.db-shm', 'other.db']);
      await deleteStoreFile('wavfeed.db');
      assert.deepEqual([...left], ['other.db']);
    });

    test('counts a store file that was never created as deleted, and still clears a stray -wal', async () => {
      const left = disk(platform, ['wavfeed.db-wal']);
      await deleteStoreFile('wavfeed.db');
      assert.deepEqual([...left], []);
    });

    test('rejects while a connection holds the file, and leaves the sidecars', async () => {
      const left = disk(platform, ['wavfeed.db', 'wavfeed.db-wal'], ['wavfeed.db']);
      await assert.rejects(deleteStoreFile('wavfeed.db'), /currently open/);
      assert.deepEqual([...left], ['wavfeed.db', 'wavfeed.db-wal']);
    });
  });
}

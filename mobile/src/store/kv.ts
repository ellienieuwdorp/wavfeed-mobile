/**
 * Typed get and set over the `kv` table: the Fetcher's walk state and the identity line, which no Raw Document holds, so a rebuild
 * leaves them standing. Values are JSON the app wrote itself.
 */
import type { SQLiteDatabase } from 'expo-sqlite';

/** The signed-in Fan as the probe answered, written by the Fetcher. Never carries a cookie. */
export type StoredIdentity = {
  readonly fanId: number;
  readonly username: string;
  readonly name: string | null;
  readonly avatarUrl: string | null;
};

export const IDENTITY_KEY = 'identity';

export async function readKv<T>(db: SQLiteDatabase, key: string): Promise<T | null> {
  const row = await db.getFirstAsync<{ value: string }>('select value from kv where key = ?', [key]);
  return row === null ? null : (JSON.parse(row.value) as T);
}

export async function writeKv(db: SQLiteDatabase, key: string, value: unknown): Promise<void> {
  const text: unknown = JSON.stringify(value);
  if (typeof text !== 'string') throw new Error(`kv value for ${key} is not JSON`);
  await db.runAsync(
    'insert into kv (key, value) values (?, ?) on conflict (key) do update set value = excluded.value',
    [key, text],
  );
}

export async function deleteKv(db: SQLiteDatabase, key: string): Promise<void> {
  await db.runAsync('delete from kv where key = ?', [key]);
}

/// <reference types="node" />
/**
 * The store's code over `node:sqlite`: the handful of `expo-sqlite` calls the store makes, answered by the same SQLite,
 * so tests and the timing check run the real migrations, Projection and queries off the phone (task 0036).
 */
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import type { SQLiteDatabase } from 'expo-sqlite';

import { migrate } from '../src/store/migrations';

class NodeDb {
  readonly d: DatabaseSync;
  constructor(file: string) {
    this.d = new DatabaseSync(file);
  }
  async execAsync(sql: string): Promise<void> {
    this.d.exec(sql);
  }
  async runAsync(sql: string, params: SQLInputValue[] = []): Promise<{ changes: number; lastInsertRowId: number }> {
    const r = this.d.prepare(sql).run(...params);
    return { changes: Number(r.changes), lastInsertRowId: Number(r.lastInsertRowid) };
  }
  async getFirstAsync<T>(sql: string, params: SQLInputValue[] = []): Promise<T | null> {
    return (this.d.prepare(sql).get(...params) as T | undefined) ?? null;
  }
  async getAllAsync<T>(sql: string, params: SQLInputValue[] = []): Promise<T[]> {
    return this.d.prepare(sql).all(...params) as T[];
  }
  async withTransactionAsync(work: () => Promise<void>): Promise<void> {
    await this.withExclusiveTransactionAsync(work);
  }
  async withExclusiveTransactionAsync(work: (txn: NodeDb) => Promise<void>): Promise<void> {
    this.d.exec('begin exclusive');
    try {
      await work(this);
      this.d.exec('commit');
    } catch (error) {
      this.d.exec('rollback');
      throw error;
    }
  }
}

/** A migrated store; in memory unless `file` names one. */
export async function openTestStore(file = ':memory:'): Promise<{ db: SQLiteDatabase; close: () => void }> {
  const node = new NodeDb(file);
  if (file !== ':memory:') node.d.exec('pragma journal_mode = wal');
  const db = node as unknown as SQLiteDatabase;
  await migrate(db);
  return { db, close: () => node.d.close() };
}

/// <reference types="node" />
/**
 * The store's code over `node:sqlite`: the handful of `expo-sqlite` calls the store makes, answered by the same SQLite,
 * so tests and the timing check run the real migrations, Projection and queries off the phone. A store on
 * a file opens a second connection for each exclusive transaction and begins it deferred, as expo-sqlite does; one in
 * memory has no second connection to open, so its exclusive transactions run on the one it has (review finding ARCH-8).
 */
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import type { SQLiteDatabase } from 'expo-sqlite';

import { migrate } from '../src/store/migrations';

class NodeDb {
  readonly d: DatabaseSync;
  readonly file: string;
  constructor(file: string) {
    this.file = file;
    this.d = new DatabaseSync(file);
  }
  async execAsync(sql: string): Promise<void> {
    this.d.exec(sql);
  }
  runSync(sql: string, params: SQLInputValue[] = []): { changes: number; lastInsertRowId: number } {
    const r = this.d.prepare(sql).run(...params);
    return { changes: Number(r.changes), lastInsertRowId: Number(r.lastInsertRowid) };
  }
  async runAsync(sql: string, params: SQLInputValue[] = []): Promise<{ changes: number; lastInsertRowId: number }> {
    return this.runSync(sql, params);
  }
  async getFirstAsync<T>(sql: string, params: SQLInputValue[] = []): Promise<T | null> {
    return (this.d.prepare(sql).get(...params) as T | undefined) ?? null;
  }
  async getAllAsync<T>(sql: string, params: SQLInputValue[] = []): Promise<T[]> {
    return this.d.prepare(sql).all(...params) as T[];
  }
  async prepareAsync(sql: string) {
    const statement = this.d.prepare(sql);
    return {
      async executeAsync(params: SQLInputValue[] = []) {
        const r = statement.run(...params);
        return { changes: Number(r.changes), lastInsertRowId: Number(r.lastInsertRowid) };
      },
      async finalizeAsync() {},
    };
  }
  async withTransactionAsync(work: () => Promise<void>): Promise<void> {
    await this.inTransaction(this, 'begin', () => work());
  }
  async withExclusiveTransactionAsync(work: (txn: NodeDb) => Promise<void>): Promise<void> {
    if (this.file === ':memory:') return this.inTransaction(this, 'begin exclusive', work);
    const txn = new NodeDb(this.file);
    try {
      await this.inTransaction(txn, 'begin', work);
    } finally {
      txn.d.close();
    }
  }
  private async inTransaction(txn: NodeDb, begin: string, work: (txn: NodeDb) => Promise<void>): Promise<void> {
    txn.d.exec(begin);
    try {
      await work(txn);
      txn.d.exec('commit');
    } catch (error) {
      txn.d.exec('rollback');
      throw error;
    }
  }
}

/** A migrated store; in memory unless `file` names one. */
export async function openTestStore(file = ':memory:'): Promise<{ db: SQLiteDatabase; close: () => void }> {
  const node = new NodeDb(file);
  if (file !== ':memory:') node.d.exec('pragma journal_mode = wal; pragma synchronous = normal');
  const db = node as unknown as SQLiteDatabase;
  await migrate(db);
  return { db, close: () => node.d.close() };
}

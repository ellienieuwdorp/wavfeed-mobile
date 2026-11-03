/**
 * The hearts' shared truth (DESIGN-UI section 12, ADR-0016): `wishlist_items` as one set of keys, read single-flight
 * per store version, so a version bump with every heart and row menu of three tabs mounted reads the table once
 * (finding TECH-M1). A confirmed write patches the set at once, and a read that started before the patch is dropped,
 * since it may not hold the write. Beside the set sits each item's intent, what the Fan's last press asked for while
 * its exchange travels (ADR-0016 amendment 2026-10-02): every heart and row menu for that item draws the intent over
 * the set, so a press shows everywhere at once. Each heart selects its own key's answer, so a change re-renders only
 * the hearts it moves. Each database owns a lifetime, retired before its contents are removed; late reads and presses
 * cannot publish into a replacement lifetime, including a Demo conversion that keeps the database handle.
 */
import type { SQLiteDatabase } from 'expo-sqlite';

import type { ItemType } from '@/domain/types';
import { readWishlistState } from '@/store/queries';

type Held = { readonly version: number; readonly keys: ReadonlySet<string> };

/** Captured by an exchange before it awaits, so a replacement on the same database cannot revive it. */
export type WishlistLifetime = {
  readonly active: () => boolean;
  /** Admits local persistence while active, tracks its drain, and returns false if retired before settlement. */
  readonly runLocal: (work: () => Promise<unknown>) => Promise<boolean>;
};

type Store = {
  held: Held | null;
  inflight: { readonly version: number } | null;
  intents: ReadonlyMap<string, boolean>;
  generation: number;
  retired: boolean;
  readonly lifetime: WishlistLifetime;
  readonly listeners: Set<() => void>;
  readonly local: Set<Promise<boolean>>;
};

/** One heart's answer: `unknown` until a read of this store has landed. */
export type KeyMembership = 'unknown' | 'on' | 'off';

const stores = new WeakMap<SQLiteDatabase, Store>();

function fresh(listeners = new Set<() => void>()): Store {
  const store: Store = {
    held: null, inflight: null, intents: new Map(), generation: 0, retired: false,
    listeners, local: new Set(),
    lifetime: {
      active: () => !store.retired,
      runLocal(work) {
        if (store.retired) return Promise.resolve(false);
        // Registration precedes work, including synchronous callbacks inside it; retired queued work never starts.
        const operation = Promise.resolve().then(async () => {
          if (store.retired) return false;
          await work();
          return !store.retired;
        });
        store.local.add(operation);
        const settled = () => store.local.delete(operation);
        void operation.then(settled, settled);
        return operation;
      },
    },
  };
  return store;
}

function storeOf(db: SQLiteDatabase): Store {
  let store = stores.get(db);
  if (store === undefined) {
    store = fresh();
    stores.set(db, store);
  }
  return store;
}

export function wishlistLifetime(db: SQLiteDatabase): WishlistLifetime {
  return storeOf(db).lifetime;
}

/** Retires immediately and drains admitted local persistence before close or erasure; network work is not awaited. */
export async function retireWishlist(db: SQLiteDatabase): Promise<void> {
  const store = storeOf(db);
  store.retired = true;
  store.held = null;
  store.inflight = null;
  store.intents = new Map();
  notify(store);
  await Promise.allSettled(store.local);
}

/** The Demo conversion opens a fresh lifetime only after emptying the same database. */
export function beginWishlist(db: SQLiteDatabase): void {
  const old = storeOf(db);
  if (!old.retired) return;
  const store = fresh(old.listeners);
  stores.set(db, store);
  notify(store);
}

export function keyOf(itemType: ItemType, itemId: string): string {
  return `${itemType}:${itemId}`;
}

function notify(store: Store) {
  for (const listener of store.listeners) listener();
}

export function subscribe(db: SQLiteDatabase, listener: () => void): () => void {
  const { listeners } = storeOf(db);
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function covers(at: { readonly version: number } | null, version: number): boolean {
  return at !== null && at.version >= version;
}

/** Reads the set for `version` unless it is held or already being read; the in-flight version is set before the await. */
export function loadMembership(db: SQLiteDatabase, version: number): void {
  const store = storeOf(db);
  if (store.retired || covers(store.held, version) || covers(store.inflight, version)) return;
  const flight = { version };
  const started = store.generation;
  store.inflight = flight;
  const land = () => {
    if (store.inflight === flight) store.inflight = null;
  };
  void readWishlistState(db).then(
    (answer) => {
      land();
      if (store.retired || started !== store.generation || covers(store.held, version)) return;
      store.held = { version, keys: new Set(answer.items.map((item) => keyOf(item.itemType, item.itemId))) };
      notify(store);
    },
    land,
  );
}

/** What the store last confirmed, whatever a press is asking for. */
export function membershipOf(db: SQLiteDatabase, key: string): KeyMembership {
  const { held, retired } = storeOf(db);
  if (retired || held === null) return 'unknown';
  return held.keys.has(key) ? 'on' : 'off';
}

/** What a heart draws: the travelling press's intent over the confirmed answer. */
export function shownOf(db: SQLiteDatabase, key: string): KeyMembership {
  const confirmed = membershipOf(db, key);
  const intent = storeOf(db).intents.get(key);
  if (confirmed === 'unknown' || intent === undefined) return confirmed;
  return intent ? 'on' : 'off';
}

export function patchMembership(db: SQLiteDatabase, key: string, on: boolean) {
  const store = storeOf(db);
  if (store.retired || store.held === null) return;
  const keys = new Set(store.held.keys);
  if (on) keys.add(key);
  else keys.delete(key);
  store.generation += 1;
  store.held = { ...store.held, keys };
  notify(store);
}

/** The membership the item's last press asked for, null while no exchange for it travels. */
export function intentOf(db: SQLiteDatabase, key: string): boolean | null {
  return storeOf(db).intents.get(key) ?? null;
}

export function setIntent(db: SQLiteDatabase, key: string, on: boolean | null) {
  const store = storeOf(db);
  if (store.retired) return;
  const next = new Map(store.intents);
  if (on === null) next.delete(key);
  else next.set(key, on);
  store.intents = next;
  notify(store);
}

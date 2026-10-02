/**
 * The hearts' shared truth (DESIGN-UI section 12, ADR-0016): `wishlist_items` as one set of keys, read single-flight
 * per store version, so a version bump with every heart and row menu of four tabs mounted reads the table once
 * (finding TECH-M1). A confirmed write patches the set at once, and a read that started before the patch is dropped,
 * since it may not hold the write. Beside the set sits each item's intent, what the Fan's last press asked for while
 * its exchange travels (ADR-0016 amendment 2026-10-02): every heart and row menu for that item draws the intent over
 * the set, so a press shows everywhere at once. Each heart selects its own key's answer, so a change re-renders only
 * the hearts it moves.
 */
import type { SQLiteDatabase } from 'expo-sqlite';

import type { ItemType } from '@/domain/types';
import { readWishlistState } from '@/store/queries';

type At = { readonly db: SQLiteDatabase; readonly version: number };
type Held = At & { readonly keys: ReadonlySet<string> };

/** One heart's answer: `unknown` until a read of this store has landed. */
export type KeyMembership = 'unknown' | 'on' | 'off';

let held: Held | null = null;
let inflight: At | null = null;
let intents: ReadonlyMap<string, boolean> = new Map();
let generation = 0;
const listeners = new Set<() => void>();

export function keyOf(itemType: ItemType, itemId: string): string {
  return `${itemType}:${itemId}`;
}

function notify() {
  for (const listener of listeners) listener();
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function covers(at: At | null, db: SQLiteDatabase, version: number): boolean {
  return at !== null && at.db === db && at.version >= version;
}

/** Reads the set for `version` unless it is held or already being read; the in-flight version is set before the await. */
export function loadMembership(db: SQLiteDatabase, version: number): void {
  if (covers(held, db, version) || covers(inflight, db, version)) return;
  const flight: At = { db, version };
  const started = generation;
  inflight = flight;
  const land = () => {
    if (inflight === flight) inflight = null;
  };
  void readWishlistState(db).then(
    (answer) => {
      land();
      if (started !== generation || covers(held, db, version)) return;
      held = { db, version, keys: new Set(answer.items.map((item) => keyOf(item.itemType, item.itemId))) };
      notify();
    },
    land,
  );
}

/** What the store last confirmed, whatever a press is asking for. */
export function membershipOf(db: SQLiteDatabase, key: string): KeyMembership {
  if (held === null || held.db !== db) return 'unknown';
  return held.keys.has(key) ? 'on' : 'off';
}

/** What a heart draws: the travelling press's intent over the confirmed answer. */
export function shownOf(db: SQLiteDatabase, key: string): KeyMembership {
  const confirmed = membershipOf(db, key);
  const intent = intents.get(key);
  if (confirmed === 'unknown' || intent === undefined) return confirmed;
  return intent ? 'on' : 'off';
}

export function patchMembership(key: string, on: boolean) {
  if (held === null) return;
  const keys = new Set(held.keys);
  if (on) keys.add(key);
  else keys.delete(key);
  generation += 1;
  held = { ...held, keys };
  notify();
}

/** The membership the item's last press asked for, null while no exchange for it travels. */
export function intentOf(key: string): boolean | null {
  return intents.get(key) ?? null;
}

export function setIntent(key: string, on: boolean | null) {
  const next = new Map(intents);
  if (on === null) next.delete(key);
  else next.set(key, on);
  intents = next;
  notify();
}

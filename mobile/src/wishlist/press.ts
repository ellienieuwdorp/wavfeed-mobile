/**
 * A press's life on one item, last tap wins (ADR-0016 amendment 2026-10-02): the press sets the item's intent in the
 * shared store, which every heart draws at once, and starts an exchange unless one for that item is already
 * travelling, in which case it only moves the intent. When an exchange settles well the store's set takes what it
 * sent, and an intent that has since moved away sends one more exchange for it. When one fails the intent is dropped,
 * so the heart shows the truth again, and the Fan is told only if the intent they last pressed for differs from that
 * truth. A follow-up exchange runs through the latest press's `Travel`, so its Tally names the surface last pressed.
 */
import type { SQLiteDatabase } from 'expo-sqlite';

import { intentOf, membershipOf, patchMembership, setIntent, wishlistLifetime, type WishlistLifetime } from './membership';

/** Raises the failure's notice; an exchange that went through answers null. */
export type Tell = () => void;

export type Travel = {
  readonly db: SQLiteDatabase;
  /** One exchange asking for `on`. It never rejects: a throw is a failure with its own `Tell`. */
  readonly send: (on: boolean) => Promise<Tell | null>;
  /** After a confirmed write has reached the store's set. */
  readonly saved: () => void;
};

const travels = new WeakMap<WishlistLifetime, Map<string, Travel>>();

export function pressItem(key: string, on: boolean, travel: Travel): boolean {
  const lifetime = wishlistLifetime(travel.db);
  if (!lifetime.active()) return false;
  let latest = travels.get(lifetime);
  if (latest === undefined) {
    latest = new Map();
    travels.set(lifetime, latest);
  }
  const travelling = intentOf(travel.db, key) !== null;
  latest.set(key, travel);
  setIntent(travel.db, key, on);
  if (!travelling) void carry(lifetime, latest, key, on);
  return true;
}

async function carry(lifetime: WishlistLifetime, latest: Map<string, Travel>, key: string, sent: boolean): Promise<void> {
  if (!lifetime.active()) return;
  const travel = latest.get(key);
  if (travel === undefined) return;
  const tell = await travel.send(sent);
  // A sent remote write cannot be recalled; its old owner publishes nothing and sends no follow-up (task 0068).
  if (!lifetime.active()) return;
  const intent = intentOf(travel.db, key) ?? sent;
  if (tell === null) {
    patchMembership(travel.db, key, sent);
    travel.saved();
    if (intent !== sent) return carry(lifetime, latest, key, intent);
    latest.delete(key);
    setIntent(travel.db, key, null);
    return;
  }
  const truth = membershipOf(travel.db, key) === 'on';
  latest.delete(key);
  setIntent(travel.db, key, null);
  if (intent !== truth) tell();
}

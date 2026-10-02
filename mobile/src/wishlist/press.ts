/**
 * A press's life on one item, last tap wins (ADR-0016 amendment 2026-10-02): the press sets the item's intent in the
 * shared store, which every heart draws at once, and starts an exchange unless one for that item is already
 * travelling, in which case it only moves the intent. When an exchange settles well the store's set takes what it
 * sent, and an intent that has since moved away sends one more exchange for it. When one fails the intent is dropped,
 * so the heart shows the truth again, and the Fan is told only if the intent they last pressed for differs from that
 * truth. A follow-up exchange runs through the latest press's `Travel`, so its Tally names the surface last pressed.
 */
import type { SQLiteDatabase } from 'expo-sqlite';

import { intentOf, membershipOf, patchMembership, setIntent } from './membership';

/** Raises the failure's notice; an exchange that went through answers null. */
export type Tell = () => void;

export type Travel = {
  readonly db: SQLiteDatabase;
  /** One exchange asking for `on`. It never rejects: a throw is a failure with its own `Tell`. */
  readonly send: (on: boolean) => Promise<Tell | null>;
  /** After a confirmed write has reached the store's set. */
  readonly saved: () => void;
};

const latest = new Map<string, Travel>();

export function pressItem(key: string, on: boolean, travel: Travel): void {
  const travelling = intentOf(key) !== null;
  latest.set(key, travel);
  setIntent(key, on);
  if (!travelling) void carry(key, on);
}

async function carry(key: string, sent: boolean): Promise<void> {
  const travel = latest.get(key);
  if (travel === undefined) return;
  const tell = await travel.send(sent);
  const intent = intentOf(key) ?? sent;
  if (tell === null) {
    patchMembership(key, sent);
    travel.saved();
    if (intent !== sent) return carry(key, intent);
    latest.delete(key);
    setIntent(key, null);
    return;
  }
  const truth = membershipOf(travel.db, key) === 'on';
  latest.delete(key);
  setIntent(key, null);
  if (intent !== truth) tell();
}

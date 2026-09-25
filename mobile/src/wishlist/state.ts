/**
 * The heart's truth and its press (DESIGN-UI section 12, ADR-0016, task 0036). Membership is `wishlist_items` as the
 * Projection last folded it, read once per store version into one set every heart shares. A press is one Wishlist
 * Action run on the device: the crumb exchange through the session, every response through `putRaw` before the outcome
 * is acted on (ADR-0004), then the item written into or out of `wishlist_items` here, because the Projection folds only
 * the wishlist walk and never a collect answer. A rebuild therefore forgets a press until the next walk brings it back.
 * Pending belongs to the item, never the control, so the bar's heart does not carry a press across a track change.
 */
import type { SQLiteDatabase } from 'expo-sqlite';
import { router } from 'expo-router';
import { useCallback, useEffect, useSyncExternalStore } from 'react';

import type { WishlistFailure, WishlistWriteKind } from '@/bandcamp/wishlist';
import { useNotice, type NoticeLine } from '@/components/noticeState';
import { copy } from '@/copy';
import type { ItemType } from '@/domain/types';
import { useAppState, type AppState } from '@/state/appState';
import { IDENTITY_KEY, readKv, type StoredIdentity } from '@/store/kv';
import { readTracklist, readWishlistState } from '@/store/queries';

import { wishlistCopy } from './copy';

/** What a press acts on, and the Release whose Page the write has to name. */
export type WishlistTarget = {
  readonly itemType: ItemType;
  readonly itemId: string;
  readonly release: { readonly itemType: ItemType; readonly itemId: string };
};

export type Membership = { readonly known: false } | { readonly known: true; readonly wishlisted: boolean };

type Held = { readonly db: SQLiteDatabase; readonly version: number; readonly keys: ReadonlySet<string> };
type PressFailure = WishlistFailure | 'not_signed_in' | 'unknown_item';

let held: Held | null = null;
let pending: ReadonlyMap<string, WishlistWriteKind> = new Map();
let generation = 0;
const listeners = new Set<() => void>();

function keyOf(itemType: ItemType, itemId: string): string {
  return `${itemType}:${itemId}`;
}

function notify() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function load(db: SQLiteDatabase, version: number) {
  if (held !== null && held.db === db && held.version >= version) return;
  const started = generation;
  void readWishlistState(db).then(
    (answer) => {
      if (started !== generation || (held !== null && held.db === db && held.version >= version)) return;
      held = { db, version, keys: new Set(answer.items.map((item) => keyOf(item.itemType, item.itemId))) };
      notify();
    },
    () => undefined,
  );
}

function patch(key: string, on: boolean) {
  if (held === null) return;
  const keys = new Set(held.keys);
  if (on) keys.add(key);
  else keys.delete(key);
  generation += 1;
  held = { ...held, keys };
  notify();
}

function setPending(key: string, action: WishlistWriteKind | null) {
  const next = new Map(pending);
  if (action === null) next.delete(key);
  else next.set(key, action);
  pending = next;
  notify();
}

export function useMembership(itemType: ItemType, itemId: string): Membership {
  const { db, version } = useAppState();
  const snapshot = useSyncExternalStore(subscribe, () => held);
  useEffect(() => load(db, version), [db, version]);
  if (snapshot === null || snapshot.db !== db) return { known: false };
  return { known: true, wishlisted: snapshot.keys.has(keyOf(itemType, itemId)) };
}

export function usePendingAction(itemType: ItemType, itemId: string): WishlistWriteKind | null {
  const map = useSyncExternalStore(subscribe, () => pending);
  return map.get(keyOf(itemType, itemId)) ?? null;
}

/** The Release's Page off the catalog, else off its stored release page. */
async function readBandId(db: SQLiteDatabase, release: WishlistTarget['release']): Promise<string | null> {
  const itemId = Number(release.itemId);
  if (!Number.isSafeInteger(itemId)) return null;
  const row = await db.getFirstAsync<{ band_id: number }>('select band_id from releases where item_type = ? and item_id = ?', [
    release.itemType,
    itemId,
  ]);
  if (row !== null) return String(row.band_id);
  return (await readTracklist(db, release.itemType, itemId))?.bandId ?? null;
}

async function writeMembership(db: SQLiteDatabase, target: WishlistTarget, bandId: string, on: boolean) {
  const itemId = Number(target.itemId);
  if (!on) {
    await db.runAsync('delete from wishlist_items where item_type = ? and item_id = ?', [target.itemType, itemId]);
    return;
  }
  const now = new Date().toISOString();
  await db.runAsync(
    `insert into wishlist_items (item_type, item_id, band_id, added_at, last_seen_snapshot_at) values (?, ?, ?, ?, ?)
     on conflict (item_type, item_id) do update set
       band_id = coalesce(excluded.band_id, wishlist_items.band_id),
       last_seen_snapshot_at = max(excluded.last_seen_snapshot_at, wishlist_items.last_seen_snapshot_at)`,
    [target.itemType, itemId, Number(bandId), now, now],
  );
}

/** Ok, or the reason it did not reach Bandcamp; the documents are already stored by the time this answers. */
async function send(app: AppState, target: WishlistTarget, action: WishlistWriteKind): Promise<PressFailure | null> {
  const identity = await readKv<StoredIdentity>(app.db, IDENTITY_KEY);
  if (identity === null) return 'not_signed_in';
  const bandId = await readBandId(app.db, target.release);
  if (bandId === null) return 'unknown_item';
  const item = { fanId: identity.fanId, itemType: target.itemType, itemId: target.itemId, bandId };
  const outcome = action === 'add' ? await app.session.collectItem(item) : await app.session.uncollectItem(item);
  for (const document of outcome.documents) await app.putRaw(document);
  if (!outcome.ok) return outcome.failure;
  await writeMembership(app.db, target, bandId, action === 'add');
  return null;
}

function noticeFor(failure: PressFailure | 'other'): NoticeLine {
  const signIn = { onPress: () => router.push('/connect') };
  switch (failure) {
    case 'logged_out':
      return { text: wishlistCopy.notice.loggedOut, action: { label: copy.notice.signInAgain, ...signIn } };
    case 'not_signed_in':
      return { text: wishlistCopy.notice.notSignedIn, action: { label: wishlistCopy.notice.signIn, ...signIn } };
    case 'bandcamp_unreachable':
      return { text: wishlistCopy.notice.unreachable };
    case 'bandcamp_rejected':
      return { text: wishlistCopy.notice.rejected };
    default:
      return { text: wishlistCopy.notice.other };
  }
}

/** One press, one exchange: a second press on the same item while one travels is turned away. */
export function useWishlistPress(): (target: WishlistTarget, action: WishlistWriteKind) => void {
  const app = useAppState();
  const { show } = useNotice();
  return useCallback(
    (target, action) => {
      const key = keyOf(target.itemType, target.itemId);
      if (pending.has(key)) return;
      setPending(key, action);
      send(app, target, action)
        .then((failure) => {
          if (failure !== null) show(noticeFor(failure));
          else {
            patch(key, action === 'add');
            app.invalidate();
          }
        })
        .catch(() => show(noticeFor('other')))
        .finally(() => setPending(key, null));
    },
    [app, show],
  );
}

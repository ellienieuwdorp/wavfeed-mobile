/**
 * The heart's truth and its press (DESIGN-UI section 12, ADR-0016, task 0036). Membership is `wishlist_items` as the
 * Projection last folded it, read once per store version into one set every heart shares. A press is one Wishlist
 * Action run on the device: the crumb read off the Release's page, or off the newest Story's Release on bandcamp.com
 * when it sits on a custom domain, and the write through the session (ADR-0016 amendment 2026-09-28), every response
 * through `putRaw` before the outcome is acted on (ADR-0004), then the item written into or out of `wishlist_items`
 * here, because the Projection folds only the wishlist walk and never a collect answer. A rebuild therefore forgets a press until the next walk brings it back.
 * Pending belongs to the item, never the control, so the bar's heart does not carry a press across a track change.
 * Membership is not asked yet until a wishlist walk has been asked once (`GatherState.wishlistAskedAt`), whatever it
 * answered, so a wishlist that keeps erroring still leaves every heart pressable, as off. Each press logs one line of
 * codes, counts, where the crumb came from, the answer's field names and flags and Bandcamp's reason scrubbed by
 * `toDetail`, never a header, a crumb or a field named like a secret (task 0036, decision 1); a refusal's notice carries
 * that reason when Bandcamp gave one.
 */
import type { SQLiteDatabase } from 'expo-sqlite';
import { router } from 'expo-router';
import { useCallback, useEffect, useSyncExternalStore } from 'react';

import type { WishlistFailure, WishlistWire, WishlistWriteKind } from '@/bandcamp/wishlist';
import { useNotice, type NoticeLine } from '@/components/noticeState';
import { copy } from '@/copy';
import type { ApiReleaseTracksResponse } from '@/domain/apiTypes';
import type { ItemType } from '@/domain/types';
import { useAppState, type AppState } from '@/state/appState';
import { IDENTITY_KEY, readKv, type StoredIdentity } from '@/store/kv';
import { readNewestBandcampReleaseUrl, readTracklist, readWishlistState } from '@/store/queries';
import { connectHref, wishlistActionFinished, type PressSurface } from '@/tally/actions';
import { useSharing } from '@/tally/Sharing';

import { wishlistCopy } from './copy';

/** What a press acts on, and the Release whose Page the write has to name. */
export type WishlistTarget = {
  readonly itemType: ItemType;
  readonly itemId: string;
  readonly release: { readonly itemType: ItemType; readonly itemId: string };
};

export type Membership = { readonly known: false } | { readonly known: true; readonly wishlisted: boolean };

type Held = { readonly db: SQLiteDatabase; readonly version: number; readonly keys: ReadonlySet<string> };
export type PressFailure = WishlistFailure | 'not_signed_in' | 'unknown_item' | 'not_on_release';
type BandSource = 'page' | 'fetched_page' | 'row';
type Sent = {
  readonly failure: PressFailure | null;
  readonly reason: string | null;
  readonly band: { readonly id: string; readonly from: BandSource } | null;
  readonly wire: WishlistWire | null;
};

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
  const { db, version, gather } = useAppState();
  const snapshot = useSyncExternalStore(subscribe, () => held);
  useEffect(() => load(db, version), [db, version]);
  const asked = gather.wishlistFetchedAt !== null || gather.wishlistAskedAt !== null;
  if (!asked || snapshot === null || snapshot.db !== db) return { known: false };
  return { known: true, wishlisted: snapshot.keys.has(keyOf(itemType, itemId)) };
}

export function usePendingAction(itemType: ItemType, itemId: string): WishlistWriteKind | null {
  const map = useSyncExternalStore(subscribe, () => pending);
  return map.get(keyOf(itemType, itemId)) ?? null;
}

type Band = { id: string; from: BandSource; tracklist: ApiReleaseTracksResponse | null; url: string };

/**
 * The server's order (api wishlist.ts): the stored page's `current.band_id`, a fresh page when none is held, the row.
 * The row is read first for its `url`, the page the write reads its crumb from, so a Release with no row is unknown.
 */
async function readBand(app: AppState, release: WishlistTarget['release']): Promise<Band | null> {
  const itemId = Number(release.itemId);
  if (!Number.isSafeInteger(itemId)) return null;
  const row = await app.db.getFirstAsync<{ band_id: number; url: string }>(
    'select band_id, url from releases where item_type = ? and item_id = ?',
    [release.itemType, itemId],
  );
  if (row === null) return null;
  const stored = await readTracklist(app.db, release.itemType, itemId);
  if (stored !== null) return { id: stored.bandId, from: 'page', tracklist: stored, url: row.url };
  const answer = await app.session.fetchReleasePage(row.url, { itemType: release.itemType, itemId });
  if (answer.kind === 'ok' && answer.value.kind === 'page') {
    await app.putRaw(answer.value.document);
    const fetched = await readTracklist(app.db, release.itemType, itemId);
    if (fetched !== null) return { id: fetched.bandId, from: 'fetched_page', tracklist: fetched, url: row.url };
  }
  return { id: String(row.band_id), from: 'row', tracklist: null, url: row.url };
}

/** Bandcamp writes ids as numbers or digit strings; both sides are compared as canonical digits. */
function sameId(left: string, right: string): boolean {
  const canonical = (id: string) => id.trim().replace(/^0+(?=\d)/, '');
  return canonical(left) === canonical(right);
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

/** The documents are already stored by the time this answers. A Track press names a Track its Release holds. */
async function send(app: AppState, target: WishlistTarget, action: WishlistWriteKind): Promise<Sent> {
  const identity = await readKv<StoredIdentity>(app.db, IDENTITY_KEY);
  if (identity === null) return { failure: 'not_signed_in', reason: null, band: null, wire: null };
  const found = await readBand(app, target.release);
  if (found === null) return { failure: 'unknown_item', reason: null, band: null, wire: null };
  const band = { id: found.id, from: found.from };
  const tracks = found.tracklist?.tracks ?? [];
  if (target.itemType === 't' && !sameId(target.itemId, target.release.itemId) && tracks.length > 0) {
    if (!tracks.some((track) => track.trackId !== null && sameId(track.trackId, target.itemId))) {
      return { failure: 'not_on_release', reason: null, band, wire: null };
    }
  }
  const item = {
    fanId: identity.fanId,
    itemType: target.itemType,
    itemId: target.itemId.trim(),
    bandId: band.id,
    releaseUrl: found.url,
    standInUrl: await readNewestBandcampReleaseUrl(app.db),
  };
  const outcome = action === 'add' ? await app.session.collectItem(item) : await app.session.uncollectItem(item);
  for (const document of outcome.documents) await app.putRaw(document);
  if (!outcome.ok) return { failure: outcome.failure, reason: outcome.reason, band, wire: outcome.wire };
  await writeMembership(app.db, target, band.id, action === 'add');
  return { failure: null, reason: null, band, wire: outcome.wire };
}

/**
 * One line per press for the Metro log: codes, counts, ids, the crumb's source word and page reads, the answer's shape
 * and the Release a Track press read its `band_id` off, never a crumb or a value named like a secret.
 */
function logPress(action: WishlistWriteKind, target: WishlistTarget, sent: Sent) {
  const key = keyOf(target.itemType, target.itemId);
  const release = keyOf(target.release.itemType, target.release.itemId);
  const facts = [
    `wishlist ${action} ${key}`,
    ...(release === key ? [] : [`on=${release}`]),
    sent.failure ?? 'ok',
    sent.wire === null ? 'no write sent' : `end=${sent.wire.end} status=${sent.wire.status ?? 'none'}`,
    ...(sent.wire === null ? [] : [`requests=${sent.wire.requests} answer=${sent.wire.answer ?? 'none'}`]),
    ...(sent.wire === null ? [] : [`crumb=${sent.wire.crumb} pages=${sent.wire.pages}`]),
    ...(sent.wire === null || sent.wire.pages === 0 ? [] : [`page=${sent.wire.pageStatus ?? 'none'}`]),
    ...(sent.wire?.redirected === true ? ['redirected'] : []),
    ...(sent.wire?.said == null ? [] : [`shape="${sent.wire.said}"`]),
    sent.band === null ? 'band=none' : `band=${sent.band.id} from=${sent.band.from}`,
  ].join(' ');
  if (sent.failure === null) console.log(facts);
  else console.warn(facts);
}

function noticeFor(failure: PressFailure | 'other', reason: string | null = null): NoticeLine {
  const signIn = { onPress: () => router.push(connectHref('wishlist_notice')) };
  switch (failure) {
    case 'logged_out':
      return { code: 'wishlist_failed', text: wishlistCopy.notice.loggedOut, action: { label: copy.notice.signInAgain, ...signIn } };
    case 'not_signed_in':
      return { code: 'wishlist_failed', text: wishlistCopy.notice.notSignedIn, action: { label: wishlistCopy.notice.signIn, ...signIn } };
    case 'bandcamp_unreachable':
      return { code: 'wishlist_failed', text: wishlistCopy.notice.unreachable };
    case 'bandcamp_rejected':
      return { code: 'wishlist_failed', text: reason === null ? wishlistCopy.notice.rejected : wishlistCopy.notice.rejectedSaying(reason) };
    default:
      return { code: 'wishlist_failed', text: wishlistCopy.notice.other };
  }
}

/**
 * One press, one exchange: a second press on the same item while one travels is turned away. Each exchange ends in one
 * `wishlist_action_finished` naming the `surface` pressed (task 0038).
 */
export function useWishlistPress(surface: PressSurface): (target: WishlistTarget, action: WishlistWriteKind) => void {
  const app = useAppState();
  const { show } = useNotice();
  const { track } = useSharing();
  return useCallback(
    (target, action) => {
      const key = keyOf(target.itemType, target.itemId);
      if (pending.has(key)) return;
      setPending(key, action);
      const onTrack = key !== keyOf(target.release.itemType, target.release.itemId);
      let told = false;
      send(app, target, action)
        .then((sent) => {
          told = true;
          track(wishlistActionFinished({ action, surface, onTrack, failure: sent.failure, wire: sent.wire }));
          logPress(action, target, sent);
          if (sent.failure !== null) show(noticeFor(sent.failure, sent.reason));
          else {
            patch(key, action === 'add');
            app.invalidate();
          }
        })
        .catch((error: unknown) => {
          console.warn(`wishlist ${action} ${key} threw:`, error instanceof Error ? error.message : String(error));
          if (!told) track(wishlistActionFinished({ action, surface, onTrack, failure: 'other', wire: null }));
          show(noticeFor('other'));
        })
        .finally(() => setPending(key, null));
    },
    [app, show, track, surface],
  );
}

/**
 * The wishlist exchange and its local confirmation (ADR-0016, task 0068): read its owning Page, send the Fan's requested
 * write, store every response, then update membership. A retired store ends local work; a session operation already
 * entered can finish its requested network exchanges.
 */
import type { SQLiteDatabase } from 'expo-sqlite';
import type { WishlistFailure, WishlistWire, WishlistWriteKind } from '@/bandcamp/wishlist';
import { isDemoFan } from '@/demo/demo';
import type { ApiReleaseTracksResponse } from '@/domain/apiTypes';
import type { ItemType } from '@/domain/types';
import type { AppState } from '@/state/appState';
import { IDENTITY_KEY, readKv, type StoredIdentity } from '@/store/kv';
import { readNewestBandcampReleaseUrl, readTracklist } from '@/store/queries';
import type { WishlistLifetime } from './membership';

type ExchangeApp = Pick<AppState, 'db' | 'putRaw'> & {
  readonly session: Pick<AppState['session'], 'fetchReleasePage' | 'collectItem' | 'uncollectItem'>;
};

/** What a press acts on, and the Release whose Page the write has to name. */
export type WishlistTarget = {
  readonly itemType: ItemType;
  readonly itemId: string;
  readonly release: { readonly itemType: ItemType; readonly itemId: string };
};

export type PressFailure = WishlistFailure | 'not_signed_in' | 'unknown_item' | 'not_on_release';
type BandSource = 'page' | 'fetched_page' | 'row';
export type Sent = {
  readonly failure: PressFailure | null;
  readonly reason: string | null;
  readonly band: { readonly id: string; readonly from: BandSource } | null;
  readonly wire: WishlistWire | null;
  /** The Release's page, where a refused press can be made by hand. */
  readonly url?: string;
};

type Band = { id: string; from: BandSource; tracklist: ApiReleaseTracksResponse | null; url: string };

/**
 * The server's order (api wishlist.ts): the stored page's `current.band_id`, a fresh page when none is held, the row.
 * The row is read first for its `url`, the page the write reads its crumb from, so a Release with no row is unknown.
 */
async function readBand(app: ExchangeApp, release: WishlistTarget['release'], lifetime: WishlistLifetime): Promise<Band | null> {
  const itemId = Number(release.itemId);
  if (!Number.isSafeInteger(itemId)) return null;
  const row = await app.db.getFirstAsync<{ band_id: number; url: string }>(
    'select band_id, url from releases where item_type = ? and item_id = ?',
    [release.itemType, itemId],
  );
  if (!lifetime.active() || row === null) return null;
  const stored = await readTracklist(app.db, release.itemType, itemId);
  if (!lifetime.active()) return null;
  if (stored !== null) return { id: stored.bandId, from: 'page', tracklist: stored, url: row.url };
  const answer = await app.session.fetchReleasePage(row.url, { itemType: release.itemType, itemId });
  if (!lifetime.active()) return null;
  if (answer.kind === 'ok' && answer.value.kind === 'page') {
    const { document } = answer.value;
    if (!(await lifetime.runLocal(() => app.putRaw(document)))) return null;
    if (!lifetime.active()) return null;
    const fetched = await readTracklist(app.db, release.itemType, itemId);
    if (!lifetime.active()) return null;
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
export async function exchange(app: ExchangeApp, target: WishlistTarget, action: WishlistWriteKind, lifetime: WishlistLifetime): Promise<Sent | null> {
  const identity = await readKv<StoredIdentity>(app.db, IDENTITY_KEY);
  if (!lifetime.active()) return null;
  // `useWishlistPress` turns these away before flipping; the stored identity is what the write names, so it is checked
  // again. A sign-out after the press is not: it empties the jar, Bandcamp answers logged out and the heart reverts.
  if (identity === null || isDemoFan(identity.fanId)) return { failure: 'not_signed_in', reason: null, band: null, wire: null };
  const found = await readBand(app, target.release, lifetime);
  if (!lifetime.active()) return null;
  if (found === null) return { failure: 'unknown_item', reason: null, band: null, wire: null };
  const band = { id: found.id, from: found.from };
  const tracks = found.tracklist?.tracks ?? [];
  if (target.itemType === 't' && !sameId(target.itemId, target.release.itemId) && tracks.length > 0) {
    if (!tracks.some((track) => track.trackId !== null && sameId(track.trackId, target.itemId))) {
      return { failure: 'not_on_release', reason: null, band, wire: null };
    }
  }
  const standInUrl = await readNewestBandcampReleaseUrl(app.db);
  if (!lifetime.active()) return null;
  const item = {
    fanId: identity.fanId,
    itemType: target.itemType,
    itemId: target.itemId.trim(),
    bandId: band.id,
    releaseUrl: found.url,
    standInUrl,
  };
  const outcome = action === 'add' ? await app.session.collectItem(item) : await app.session.uncollectItem(item);
  // Retiring the captured lifetime ends local work after a sent write; queued follow-ups are retired in press.ts (task 0068).
  if (!lifetime.active()) return null;
  for (const document of outcome.documents) {
    if (!(await lifetime.runLocal(() => app.putRaw(document)))) return null;
    if (!lifetime.active()) return null;
  }
  if (!outcome.ok) return { failure: outcome.failure, reason: outcome.reason, band, wire: outcome.wire, url: found.url };
  if (!(await lifetime.runLocal(() => writeMembership(app.db, target, band.id, action === 'add')))) return null;
  return { failure: null, reason: null, band, wire: outcome.wire };
}

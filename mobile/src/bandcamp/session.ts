/**
 * Every request the phone makes to Bandcamp, ported from extension/lib/bandcamp.ts and server/packages/bandcamp/src
 * (task 0036, decisions 1 and 4). A credentialed call is a plain `fetch` with `credentials: 'include'` and no
 * `Cookie` header, so the jar the sign-in WebView shares attaches the session and nothing here can read it
 * (ADR-0018); public calls pass `credentials: 'omit'`. One request at a time, 500 to 1000 ms apart (ADR-0001).
 * Nothing throws or logs: a failure leaves as an answer kind and a status (ADR-0003).
 */
import {
  BAND_DETAILS_ENDPOINT,
  FEED_PAGE_ENDPOINT,
  FEED_UPDATES_ENDPOINT,
  FOLLOWING_BANDS_ENDPOINT,
  RELEASE_PAGE_ENDPOINT,
  type ReleaseKey,
  WISHLIST_ITEMS_ENDPOINT,
} from '../domain/endpoints';
import { asRecord } from '../domain/wire';
import { readJsonAttribute } from './htmlBlob';
import {
  meansAlreadyThere,
  notJsonPayload,
  readErrorText,
  readReplayCrumb,
  toDetail,
  MAX_CRUMB_REPLAYS,
  type WishlistItem,
  type WishlistWriteKind,
  type WishlistWriteOutcome,
  wishlistRequestBody,
} from './wishlist';
import {
  BAND_DETAILS_PATH,
  type BandcampAnswer,
  type BandcampDocument,
  COLLECT_ITEM_ENDPOINT,
  COLLECT_ITEM_PATH,
  COLLECTION_SUMMARY_PATH,
  DEFAULT_BANDCAMP_BASE_URL,
  FEED_UPDATES_PATH,
  FOLLOWING_BANDS_PATH,
  FORM_CONTENT_TYPE,
  formBody,
  HTML_ACCEPT,
  type Identity,
  isFetchableTarget,
  JSON_ACCEPT,
  JSON_CONTENT_TYPE,
  LOGOUT_PATH,
  MAX_UNIX_SECONDS,
  originOf,
  parseJson,
  UNCOLLECT_ITEM_ENDPOINT,
  UNCOLLECT_ITEM_PATH,
  WISHLIST_ITEMS_PATH,
} from './wire';

export const PACING_MIN_MS = 500;
export const PACING_MAX_MS = 1000;
const REQUEST_TIMEOUT_MS = 30_000;

export const FOLLOWING_BANDS_PAGE_SIZE = 500;
export const FOLLOWING_BANDS_MAX_PAGES = 20;
export const WISHLIST_ITEMS_PAGE_SIZE = 100;
export const WISHLIST_ITEMS_MAX_PAGES = 50;

const GONE_STATUSES: readonly number[] = [404, 410];

export type FeedUpdatesPage = {
  readonly document: BandcampDocument;
  readonly entryCount: number;
  readonly oldestStoryDate: number | null;
  readonly newestStoryDate: number | null;
};

/** A paginated walk. `complete` is false when a cap or a stuck cursor ended it: additive only. */
export type ListWalk = {
  readonly pages: number;
  readonly seen: number;
  readonly complete: boolean;
};

/** Called before the next request goes out, so a failed walk keeps what it fetched. */
export type OnDocument = (document: BandcampDocument) => Promise<void>;

export type BandDetails =
  | { readonly kind: 'details'; readonly document: BandcampDocument; readonly bandDetails: unknown }
  | { readonly kind: 'gone'; readonly status: number };

export type ReleasePage =
  | { readonly kind: 'page'; readonly document: BandcampDocument }
  | { readonly kind: 'gone'; readonly status: number }
  | { readonly kind: 'unparsable' }
  | { readonly kind: 'refused' };

type Credentials = 'include' | 'omit';

type SendSpec = {
  readonly method?: 'GET' | 'POST';
  readonly headers: Readonly<Record<string, string>>;
  readonly body?: string;
  readonly credentials: Credentials;
};

type Wire = {
  readonly status: number;
  readonly ok: boolean;
  readonly contentType: string;
  readonly url: string;
  readonly text: string;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function nowIso(): string {
  return new Date().toISOString();
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function countEntries(value: unknown): number {
  if (Array.isArray(value)) return value.length;
  const record = asRecord(value);
  return record === undefined ? 0 : Object.keys(record).length;
}

function looksSignedOut(body: Record<string, unknown> | undefined, text: string): boolean {
  const message = body === undefined ? '' : String(body.error_message ?? '');
  if (message.toLowerCase().includes('must be logged in')) return true;
  return body === undefined && /<html|<!doctype/i.test(text.slice(0, 500));
}

function extractFollowingBands(html: string): Record<string, unknown> | null {
  const blob = asRecord(readJsonAttribute(html, 'blob', 'pagedata'));
  if (blob === undefined) return null;
  const sequence = asRecord(blob.following_bands);
  const cache = asRecord(asRecord(blob.item_cache)?.following_bands);
  if (sequence === undefined && cache === undefined) return null;
  return {
    ...(cache === undefined ? {} : { item_cache: { following_bands: cache } }),
    ...(sequence === undefined ? {} : { following_bands: sequence }),
  };
}

export class BandcampSession {
  private readonly baseUrl: string;
  private readonly baseOrigin: string;
  private tail: Promise<unknown> = Promise.resolve();
  private lastDoneAt: number | null = null;

  constructor(baseUrl: string = DEFAULT_BANDCAMP_BASE_URL) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.baseOrigin = originOf(this.baseUrl) ?? DEFAULT_BANDCAMP_BASE_URL;
  }

  /** Queued behind whatever is on the wire, so a heart press during a turn waits. */
  private send(url: string, spec: SendSpec): Promise<Wire | null> {
    const run = (): Promise<Wire | null> => this.sendNow(url, spec);
    const next = this.tail.then(run, run);
    this.tail = next;
    return next;
  }

  private async sendNow(url: string, spec: SendSpec): Promise<Wire | null> {
    if (this.lastDoneAt !== null) {
      const gap = PACING_MIN_MS + Math.floor(Math.random() * (PACING_MAX_MS - PACING_MIN_MS));
      const wait = this.lastDoneAt + gap - Date.now();
      if (wait > 0) await sleep(wait);
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        method: spec.method ?? 'GET',
        headers: spec.headers,
        body: spec.body,
        // The whole custody design in one option (task 0036, decision 1).
        credentials: spec.credentials,
        signal: controller.signal,
      });
      const text = await response.text();
      return {
        status: response.status,
        ok: response.ok,
        contentType: (response.headers.get('content-type') ?? '').toLowerCase(),
        url: response.url,
        text,
      };
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
      this.lastDoneAt = Date.now();
    }
  }

  /** The only place logged-out is decided: signed in means JSON with a numeric `fan_id`. */
  async probeIdentity(): Promise<BandcampAnswer<Identity>> {
    const wire = await this.send(`${this.baseUrl}${COLLECTION_SUMMARY_PATH}`, {
      headers: { Accept: JSON_ACCEPT },
      credentials: 'include',
    });
    if (wire === null) return { kind: 'unreachable' };
    if (wire.status >= 500) return { kind: 'error', status: wire.status };
    if (!wire.ok || !wire.contentType.includes('json')) return { kind: 'logged_out' };

    const body = asRecord(parseJson(wire.text));
    const fanId = body?.fan_id;
    if (body === undefined || typeof fanId !== 'number' || !Number.isFinite(fanId)) {
      return { kind: 'logged_out' };
    }
    const summary = asRecord(body.collection_summary);
    const username = [body.username, summary?.username].find(
      (value): value is string => typeof value === 'string' && value !== '',
    );
    return { kind: 'ok', value: { fanId, username: username ?? null } };
  }

  /** The dash feed only regenerates when the feed page is visited. */
  async pokeFeedPage(username: string): Promise<BandcampAnswer<BandcampDocument>> {
    const url = `${this.baseUrl}/${encodeURIComponent(username)}/feed`;
    const fetchedAt = nowIso();
    const wire = await this.send(url, { headers: { Accept: HTML_ACCEPT }, credentials: 'include' });
    if (wire === null) return { kind: 'unreachable' };
    if (!wire.ok) return { kind: 'error', status: wire.status };
    return { kind: 'ok', value: { endpoint: FEED_PAGE_ENDPOINT, payload: { url, html: wire.text }, fetchedAt } };
  }

  async fetchFeedUpdates(fanId: number, olderThan: number): Promise<BandcampAnswer<FeedUpdatesPage>> {
    if (!Number.isFinite(olderThan) || olderThan <= 0 || olderThan >= MAX_UNIX_SECONDS) {
      return { kind: 'error', status: 0 };
    }
    const fetchedAt = nowIso();
    const wire = await this.send(`${this.baseUrl}${FEED_UPDATES_PATH}`, {
      method: 'POST',
      headers: { Accept: JSON_ACCEPT, 'Content-Type': FORM_CONTENT_TYPE },
      body: formBody({ fan_id: String(fanId), older_than: String(Math.floor(olderThan)) }),
      credentials: 'include',
    });
    if (wire === null) return { kind: 'unreachable' };
    if (!wire.ok) return { kind: 'error', status: wire.status };
    // HTML here is the login page: the session died between the probe and now.
    if (!wire.contentType.includes('json')) return { kind: 'logged_out' };

    const payload = parseJson(wire.text);
    const stories = asRecord(asRecord(payload)?.stories);
    if (stories === undefined || !Array.isArray(stories.entries)) return { kind: 'error', status: wire.status };
    return {
      kind: 'ok',
      value: {
        document: { endpoint: FEED_UPDATES_ENDPOINT, payload, fetchedAt },
        entryCount: stories.entries.length,
        oldestStoryDate: finiteNumber(stories.oldest_story_date),
        newestStoryDate: finiteNumber(stories.newest_story_date),
      },
    };
  }

  /** The follow page's embedded batch, then the continuation; public, so no credentials (ADR-0017). */
  async fetchFollowingBands(
    fanId: number,
    username: string,
    onDocument: OnDocument,
  ): Promise<BandcampAnswer<ListWalk>> {
    const snapshotStartedAt = nowIso();
    const pageUrl = `${this.baseUrl}/${encodeURIComponent(username)}/following/artists_and_labels`;
    const fetchedAt = nowIso();
    const first = await this.send(pageUrl, { headers: { Accept: HTML_ACCEPT }, credentials: 'omit' });
    if (first === null) return { kind: 'unreachable' };
    if (!first.ok) return { kind: 'error', status: first.status };
    const followingBands = extractFollowingBands(first.text);
    if (followingBands === null) return { kind: 'error', status: first.status };

    await onDocument({
      endpoint: FOLLOWING_BANDS_ENDPOINT,
      payload: { fanId, page: 1, snapshotStartedAt, followingBands },
      fetchedAt,
    });
    const sequence = asRecord(followingBands.following_bands);
    const itemCount = finiteNumber(sequence?.item_count);
    let token = typeof sequence?.last_token === 'string' ? sequence.last_token : null;
    let seen = countEntries(asRecord(followingBands.item_cache)?.following_bands);
    let complete = itemCount !== null && seen >= itemCount;
    let pages = 1;

    for (let page = 2; page <= FOLLOWING_BANDS_MAX_PAGES && !complete && token !== null; page += 1) {
      const request = { fan_id: fanId, older_than_token: token, count: FOLLOWING_BANDS_PAGE_SIZE };
      const pageFetchedAt = nowIso();
      const wire = await this.send(`${this.baseUrl}${FOLLOWING_BANDS_PATH}`, {
        method: 'POST',
        headers: { Accept: JSON_ACCEPT, 'Content-Type': JSON_CONTENT_TYPE },
        body: JSON.stringify(request),
        credentials: 'omit',
      });
      if (wire === null) return { kind: 'unreachable' };
      if (!wire.ok) return { kind: 'error', status: wire.status };
      const body = asRecord(parseJson(wire.text));
      if (body === undefined || !Array.isArray(body.items)) return { kind: 'error', status: wire.status };

      await onDocument({
        endpoint: FOLLOWING_BANDS_ENDPOINT,
        payload: { fanId, page, snapshotStartedAt, followingBands: body },
        fetchedAt: pageFetchedAt,
      });
      pages += 1;
      seen += body.items.length;
      if (body.more_available !== true) {
        complete = true;
        break;
      }
      const next = typeof body.last_token === 'string' ? body.last_token : null;
      if (next === null || next === token) break;
      token = next;
    }
    return { kind: 'ok', value: { pages, seen, complete } };
  }

  async fetchWishlistItems(fanId: number, onDocument: OnDocument): Promise<BandcampAnswer<ListWalk>> {
    const startedAt = new Date();
    const snapshotStartedAt = startedAt.toISOString();
    const url = `${this.baseUrl}${WISHLIST_ITEMS_PATH}`;
    let token = `${Math.floor(startedAt.getTime() / 1000)}::a::`;
    let seen = 0;
    let pages = 0;

    for (let page = 0; page < WISHLIST_ITEMS_MAX_PAGES; page += 1) {
      const request = { fan_id: fanId, older_than_token: token, count: WISHLIST_ITEMS_PAGE_SIZE };
      const fetchedAt = nowIso();
      const wire = await this.send(url, {
        method: 'POST',
        headers: { Accept: JSON_ACCEPT, 'Content-Type': JSON_CONTENT_TYPE },
        body: JSON.stringify(request),
        credentials: 'include',
      });
      if (wire === null) return { kind: 'unreachable' };
      if (wire.status >= 500) return { kind: 'error', status: wire.status };
      const body = asRecord(parseJson(wire.text));
      // Status is not the question: a signed-out answer is an error envelope under an HTTP 200.
      if (looksSignedOut(body, wire.text)) return { kind: 'logged_out' };
      if (body === undefined || !Array.isArray(body.items)) return { kind: 'error', status: wire.status };

      await onDocument({
        endpoint: WISHLIST_ITEMS_ENDPOINT,
        payload: { url, snapshot_started_at: snapshotStartedAt, request, response: body },
        fetchedAt,
      });
      pages += 1;
      seen += body.items.length;
      // An empty page with more_available is not the end: gifts are filtered server-side.
      if (body.more_available !== true) return { kind: 'ok', value: { pages, seen, complete: true } };
      const next = typeof body.last_token === 'string' ? body.last_token : null;
      if (next === null || next === token) break;
      token = next;
    }
    return { kind: 'ok', value: { pages, seen, complete: false } };
  }

  async fetchBandDetails(bandId: number): Promise<BandcampAnswer<BandDetails>> {
    const fetchedAt = nowIso();
    const wire = await this.send(`${this.baseUrl}${BAND_DETAILS_PATH}?band_id=${bandId}`, {
      headers: { Accept: JSON_ACCEPT },
      credentials: 'omit',
    });
    if (wire === null) return { kind: 'unreachable' };
    if (GONE_STATUSES.includes(wire.status)) return { kind: 'ok', value: { kind: 'gone', status: wire.status } };
    if (!wire.ok) return { kind: 'error', status: wire.status };
    const bandDetails = asRecord(parseJson(wire.text));
    if (bandDetails === undefined) return { kind: 'error', status: wire.status };
    return {
      kind: 'ok',
      value: {
        kind: 'details',
        bandDetails,
        document: { endpoint: BAND_DETAILS_ENDPOINT, payload: { bandId, bandDetails }, fetchedAt },
      },
    };
  }

  /** Stored as the page's two Bandcamp-authored blobs, keyed by the Release it was fetched for. */
  async fetchReleasePage(itemUrl: string, key: ReleaseKey): Promise<BandcampAnswer<ReleasePage>> {
    if (!isFetchableTarget(itemUrl, this.baseOrigin)) return { kind: 'ok', value: { kind: 'refused' } };
    const fetchedAt = nowIso();
    const wire = await this.send(itemUrl, { headers: { Accept: HTML_ACCEPT }, credentials: 'omit' });
    if (wire === null) return { kind: 'unreachable' };
    // The platform follows redirects itself, so the hop is checked after the fact and its body dropped.
    if (wire.url !== '' && !isFetchableTarget(wire.url, this.baseOrigin)) {
      return { kind: 'ok', value: { kind: 'refused' } };
    }
    if (GONE_STATUSES.includes(wire.status)) return { kind: 'ok', value: { kind: 'gone', status: wire.status } };
    if (!wire.ok) return { kind: 'error', status: wire.status };

    const tralbum = readJsonAttribute(wire.text, 'tralbum');
    if (tralbum === undefined || tralbum === null) return { kind: 'ok', value: { kind: 'unparsable' } };
    const band = readJsonAttribute(wire.text, 'band') ?? null;
    return {
      kind: 'ok',
      value: {
        kind: 'page',
        document: {
          endpoint: RELEASE_PAGE_ENDPOINT,
          payload: { itemType: key.itemType, itemId: key.itemId, itemUrl, tralbum, band },
          fetchedAt,
        },
      },
    };
  }

  /** The iOS WebView copies cookies it gains into the app's jar, never ones it loses: this clears the app's. */
  async signOut(): Promise<'ok' | 'unreachable'> {
    const wire = await this.send(`${this.baseUrl}${LOGOUT_PATH}`, { headers: { Accept: HTML_ACCEPT }, credentials: 'include' });
    return wire === null ? 'unreachable' : 'ok';
  }

  collectItem(item: WishlistItem): Promise<WishlistWriteOutcome> {
    return this.writeWishlist('add', item);
  }

  uncollectItem(item: WishlistItem): Promise<WishlistWriteOutcome> {
    return this.writeWishlist('remove', item);
  }

  /** The site's own heart button (ADR-0016): no crumb first, then replayed with the one `invalid_crumb` hands back. */
  private async writeWishlist(action: WishlistWriteKind, item: WishlistItem): Promise<WishlistWriteOutcome> {
    const endpoint = action === 'add' ? COLLECT_ITEM_ENDPOINT : UNCOLLECT_ITEM_ENDPOINT;
    const url = `${this.baseUrl}${action === 'add' ? COLLECT_ITEM_PATH : UNCOLLECT_ITEM_PATH}`;
    const documents: BandcampDocument[] = [];
    let crumb: string | null = null;

    for (let attempt = 0; attempt <= MAX_CRUMB_REPLAYS; attempt += 1) {
      const fetchedAt = nowIso();
      const wire = await this.send(url, {
        method: 'POST',
        headers: { Accept: JSON_ACCEPT, 'Content-Type': FORM_CONTENT_TYPE, 'X-Requested-With': 'XMLHttpRequest' },
        body: wishlistRequestBody(item, crumb),
        credentials: 'include',
      });
      if (wire === null) {
        return { ok: false, failure: 'bandcamp_unreachable', detail: 'the request did not come back', documents };
      }
      const parsed = parseJson(wire.text);
      const body = asRecord(parsed);
      documents.push({
        endpoint,
        payload: body === undefined ? notJsonPayload(wire.text, wire.contentType.includes('html')) : parsed,
        fetchedAt,
      });

      if (wire.status >= 500 || wire.status === 429) {
        return { ok: false, failure: 'bandcamp_unreachable', detail: `HTTP ${wire.status}`, documents };
      }
      const replay = readReplayCrumb(wire.status, body);
      if (replay !== null && attempt < MAX_CRUMB_REPLAYS) {
        crumb = replay;
        continue;
      }
      if (body === undefined || wire.status === 401) return await this.classifyByProbe(wire.status, documents);
      if (body.ok === true) return { ok: true, alreadyThere: false, documents };

      const errorText = readErrorText(body);
      if (errorText !== undefined && meansAlreadyThere(errorText)) return { ok: true, alreadyThere: true, documents };
      return {
        ok: false,
        failure: 'bandcamp_rejected',
        detail: toDetail(errorText ?? `HTTP ${wire.status}, a JSON body with neither ok nor an error in it`),
        documents,
      };
    }
    return { ok: false, failure: 'bandcamp_rejected', detail: 'invalid_crumb', documents };
  }

  /** A login page or a bare 401 could mean signed out or Bandcamp being strange; the probe decides. */
  private async classifyByProbe(
    status: number,
    documents: readonly BandcampDocument[],
  ): Promise<WishlistWriteOutcome> {
    const probe = await this.probeIdentity();
    if (probe.kind === 'logged_out') {
      return { ok: false, failure: 'logged_out', detail: 'Bandcamp is not signed in on this device', documents };
    }
    if (probe.kind === 'ok') {
      return { ok: false, failure: 'bandcamp_rejected', detail: `HTTP ${status}, non-JSON body`, documents };
    }
    return {
      ok: false,
      failure: 'bandcamp_unreachable',
      detail: `HTTP ${status}, and the sign-in check could not be completed`,
      documents,
    };
  }
}

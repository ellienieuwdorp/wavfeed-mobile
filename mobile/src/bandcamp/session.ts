/**
 * Every request the phone makes to Bandcamp. A credentialed call is a plain `fetch` with `credentials: 'include'` and no
 * `Cookie` header, so the jar the sign-in WebView shares attaches the session and nothing here can read it
 * (ADR-0018); public calls pass `credentials: 'omit'`. One request at a time, 500 to 1000 ms apart (ADR-0001).
 * Nothing throws or logs: a failure leaves as an answer kind and a status (ADR-0003).
 */
import {
  BAND_DETAILS_ENDPOINT,
  FEED_PAGE_ENDPOINT,
  FEED_UPDATES_ENDPOINT,
  type FeedPageEnvelope,
  FOLLOWING_BANDS_ENDPOINT,
  RELEASE_PAGE_ENDPOINT,
  type ReleaseKey,
  WISHLIST_ITEMS_ENDPOINT,
} from '../domain/endpoints';
import { Platform } from 'react-native';

import { utf8Bytes } from '../domain/hash';
import { asCount, asRecord } from '../domain/wire';
import { SAMPLE_MODE } from '../dev/sampleMode';
import { readJsonAttribute } from './htmlBlob';
import {
  crumbKeyOf,
  meansAlreadyThere,
  notJsonPayload,
  readErrorText,
  readPageCrumbs,
  readReason,
  readReplayCrumb,
  refusesCrumb,
  toDetail,
  toSaid,
  MAX_CRUMB_REPLAYS,
  type WishlistCrumbSource,
  type WishlistEnd,
  type WishlistItem,
  type WishlistWire,
  type WishlistWriteKind,
  type WishlistWriteOutcome,
  wishlistHeaders,
  wishlistRequestBody,
  withholdsCrumb,
  withoutCrumbs,
} from './wishlist';
import {
  BAND_DETAILS_PATH,
  type BandcampAnswer,
  type BandcampDocument,
  COLLECT_ITEM_ENDPOINT,
  COLLECT_ITEM_PATH,
  COLLECTION_SUMMARY_PATH,
  CRUMBS_PAGE_ENDPOINT,
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
  onBandcampHost,
  originOf,
  parseJson,
  readProbe,
  refusedOrDown,
  UNCOLLECT_ITEM_ENDPOINT,
  UNCOLLECT_ITEM_PATH,
  type Wire,
  WISHLIST_ITEMS_PATH,
} from './wire';

export const PACING_MIN_MS = 500;
export const PACING_MAX_MS = 1000;
const REQUEST_TIMEOUT_MS = 30_000;

/**
 * The browser identity the sign-in WebView already gave this session, so every
 * request looks like it came from the same browser.
 * React Native's own User-Agent names CFNetwork or okhttp, and Bandcamp
 * answered the wishlist write from it with a bare error and no reason.
 */
const USER_AGENT = Platform.select({
  ios: 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
  android: 'Mozilla/5.0 (Linux; Android 16) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36',
  default: 'Mozilla/5.0 AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
});

/**
 * Release pages alone are asked for as desktop Safari on both platforms: Bandcamp serves a phone a page with no
 * `release_date` or `mod_date` in `current` and no id on a Track that is not out. The request
 * carries no cookie, so no signed-in session is ever seen under this identity.
 */
const RELEASE_PAGE_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15';

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

/**
 * A crumb page read: `crumbs` is null when the page carried no readable `#js-crumbs-data` map, and `onBandcamp` says
 * the page was served from a host the jar sends the session to, the only kind whose map speaks for it.
 */
type CrumbPage =
  | {
      readonly kind: 'page';
      readonly status: number;
      readonly ok: boolean;
      readonly onBandcamp: boolean;
      readonly crumbs: Readonly<Record<string, string>> | null;
      readonly document: BandcampDocument;
    }
  | { readonly kind: 'unreachable' }
  | { readonly kind: 'refused' };

/** The two paths whose crumbs the session keeps, under the keys the page's map uses. */
const WISHLIST_CRUMB_KEYS: readonly string[] = [crumbKeyOf(COLLECT_ITEM_PATH), crumbKeyOf(UNCOLLECT_ITEM_PATH)];

type Credentials = 'include' | 'omit';

type SendSpec = {
  readonly method?: 'GET' | 'POST';
  readonly headers: Readonly<Record<string, string>>;
  readonly body?: string;
  readonly credentials: Credentials;
  /** Only `fetchReleasePage` names one; every other request goes as the sign-in WebView's browser. */
  readonly userAgent?: string;
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
  const message = typeof body?.error_message === 'string' ? body.error_message : '';
  if (message.toLowerCase().includes('must be logged in')) return true;
  return body === undefined && /<html|<!doctype/i.test(text.slice(0, 500));
}

/**
 * The page the crumb is read from: the Release's own on a bandcamp.com host, else the store's stand-in on one, since a
 * crumb is per path (ADR-0016 amendment 2026-09-28). With no stand-in held, the Release's own page, whose map reads
 * empty.
 */
function crumbPageOf(item: WishlistItem): string {
  if (onBandcampHost(item.releaseUrl)) return item.releaseUrl;
  return item.standInUrl !== null && onBandcampHost(item.standInUrl) ? item.standInUrl : item.releaseUrl;
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
  /**
   * The wishlist paths' crumbs as the last page read or `invalid_crumb` answer gave them, for the app's life: never
   * stored, logged or put in a Raw Document, and cleared on sign-out (ADR-0003, ADR-0016 amendment 2026-09-28).
   */
  private readonly crumbs = new Map<string, string>();

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
    // The rig's sample Fan and items never reach Bandcamp: every call answers as unreachable (ADR-0001, ADR-0016); the
    // literal `__DEV__` folds the check out of a release bundle (review ARCH-5).
    if (__DEV__ && SAMPLE_MODE) return null;
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
        headers: { ...spec.headers, 'User-Agent': spec.userAgent ?? USER_AGENT },
        body: spec.body,
        // The whole custody design in one option.
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

  async probeIdentity(): Promise<BandcampAnswer<Identity>> {
    const wire = await this.send(`${this.baseUrl}${COLLECTION_SUMMARY_PATH}`, {
      headers: { Accept: JSON_ACCEPT },
      credentials: 'include',
    });
    return readProbe(wire);
  }

  /**
   * The dash feed only regenerates when the feed page is visited. The signed-in page carries the session's crumbs and
   * nothing reads it, so it lands as an extract of its URL, status and UTF-8 byte length (ADR-0004 amendment 2026-09-29).
   */
  async pokeFeedPage(username: string): Promise<BandcampAnswer<BandcampDocument>> {
    const url = `${this.baseUrl}/${encodeURIComponent(username)}/feed`;
    const fetchedAt = nowIso();
    const wire = await this.send(url, { headers: { Accept: HTML_ACCEPT }, credentials: 'include' });
    if (wire === null) return { kind: 'unreachable' };
    if (!wire.ok) return { kind: 'error', status: wire.status };
    const payload: FeedPageEnvelope = { url, status: wire.status, bytes: utf8Bytes(wire.text).length };
    return { kind: 'ok', value: { endpoint: FEED_PAGE_ENDPOINT, payload, fetchedAt } };
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
    // Not JSON reads as signed out, as a dead session's 400 reads as an error; the turn asks the probe.
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

    const sequence = asRecord(followingBands.following_bands);
    const itemCount = asCount(sequence?.item_count);
    let token = typeof sequence?.last_token === 'string' ? sequence.last_token : null;
    let seen = countEntries(asRecord(followingBands.item_cache)?.following_bands);
    let complete = itemCount !== undefined && seen >= itemCount;
    let pages = 1;

    await onDocument({
      endpoint: FOLLOWING_BANDS_ENDPOINT,
      payload: {
        fanId, page: 1, snapshotStartedAt, followingBands,
        snapshotPage: {
          number: 1, inputToken: null,
          nextToken: complete ? null : token,
        },
      },
      fetchedAt,
    });

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
        payload: {
          fanId, page, snapshotStartedAt, followingBands: body,
          snapshotPage: { number: page, inputToken: token, nextToken: body.more_available === false ? null : body.last_token ?? null },
        },
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
      if (refusedOrDown(wire.status)) return { kind: 'error', status: wire.status };
      const body = asRecord(parseJson(wire.text));
      // Status is not the question: a signed-out answer is an error envelope under an HTTP 200.
      if (looksSignedOut(body, wire.text)) return { kind: 'logged_out' };
      if (body === undefined || !Array.isArray(body.items)) return { kind: 'error', status: wire.status };

      await onDocument({
        endpoint: WISHLIST_ITEMS_ENDPOINT,
        payload: {
          url, snapshot_started_at: snapshotStartedAt, request, response: body,
          snapshotPage: { number: page + 1, inputToken: token, nextToken: body.more_available === false ? null : body.last_token ?? null },
        },
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

  /**
   * Stored as the page's two Bandcamp-authored blobs, keyed by the Release it was fetched for. Public, and asked for as
   * a desktop browser; a Track page comes through here too.
   */
  async fetchReleasePage(itemUrl: string, key: ReleaseKey): Promise<BandcampAnswer<ReleasePage>> {
    if (!isFetchableTarget(itemUrl, this.baseOrigin)) return { kind: 'ok', value: { kind: 'refused' } };
    const fetchedAt = nowIso();
    const wire = await this.send(itemUrl, {
      headers: { Accept: HTML_ACCEPT },
      credentials: 'omit',
      userAgent: RELEASE_PAGE_USER_AGENT,
    });
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

  /**
   * The iOS WebView copies cookies it gains into the app's jar, never ones it loses: this clears the app's. Only a 2xx
   * or an unfollowed 3xx is the logout page answering; no answer, a 4xx such as an edge's 403 or 429, or a 5xx leaves
   * the session in the jar, which is `unreachable`, and Settings keeps the phone signed in (review REL-3). The rig's
   * sample Fan holds no session, so its sign-out is `ok`.
   */
  async signOut(): Promise<'ok' | 'unreachable'> {
    this.crumbs.clear();
    if (SAMPLE_MODE) return 'ok';
    const wire = await this.send(`${this.baseUrl}${LOGOUT_PATH}`, { headers: { Accept: HTML_ACCEPT }, credentials: 'include' });
    const answered = wire !== null && (wire.ok || (wire.status >= 300 && wire.status < 400));
    return answered ? 'ok' : 'unreachable';
  }

  collectItem(item: WishlistItem): Promise<WishlistWriteOutcome> {
    return this.writeWishlist('add', item);
  }

  uncollectItem(item: WishlistItem): Promise<WishlistWriteOutcome> {
    return this.writeWishlist('remove', item);
  }

  /**
   * A Release page with the jar's session attached, as the site's heart has it loaded: the crumb map in its `<head>` is
   * read and the page itself is dropped. The target guard runs before and after redirects, as for `fetchReleasePage`;
   * a custom domain passes it but gets no Bandcamp cookie from the jar, so the host it was served from is kept too.
   */
  private async readCrumbPage(url: string): Promise<CrumbPage> {
    if (!isFetchableTarget(url, this.baseOrigin)) return { kind: 'refused' };
    const fetchedAt = nowIso();
    const wire = await this.send(url, { headers: { Accept: HTML_ACCEPT }, credentials: 'include' });
    if (wire === null) return { kind: 'unreachable' };
    if (wire.url !== '' && !isFetchableTarget(wire.url, this.baseOrigin)) return { kind: 'refused' };
    const crumbs = wire.ok ? (readPageCrumbs(wire.text) ?? null) : null;
    const paths = crumbs === null ? null : Object.keys(crumbs);
    return {
      kind: 'page',
      status: wire.status,
      ok: wire.ok,
      onBandcamp: onBandcampHost(wire.url === '' ? url : wire.url),
      crumbs,
      document: { endpoint: CRUMBS_PAGE_ENDPOINT, payload: { url, status: wire.status, paths }, fetchedAt },
    };
  }

  /**
   * A bandcamp.com page's map is the truth for the wishlist keys: a key it lacks is forgotten, so a signed-out page
   * empties both. A page off bandcamp.com never reaches here.
   */
  private keepCrumbs(crumbs: Readonly<Record<string, string>> | null) {
    for (const key of WISHLIST_CRUMB_KEYS) {
      const crumb = crumbs?.[key];
      if (crumb === undefined) this.crumbs.delete(key);
      else this.crumbs.set(key, crumb);
    }
  }

  /**
   * The site's own heart (ADR-0016, amended 2026-09-28): the path's crumb from memory or `crumbPageOf`'s page, then the
   * write. A refused crumb is replayed with the fresh one the answer carries, else after one page read, at most
   * `MAX_CRUMB_REPLAYS` times; a page with no crumb goes to the probe, so signed out reads as signed out. Every crumb
   * the press sees is cut out of what it returns.
   */
  private async writeWishlist(action: WishlistWriteKind, item: WishlistItem): Promise<WishlistWriteOutcome> {
    // The rig answers the two writes itself, with no request (dev/sampleWishlist.ts); the literal `__DEV__` folds the
    // branch and its require out of a release bundle (review ARCH-5).
    if (__DEV__ && SAMPLE_MODE) {
      const rig: typeof import('../dev/sampleWishlist') = require('../dev/sampleWishlist');
      const answer = await rig.sampleWishlistWrite();
      if (answer !== null) return answer;
    }
    const path = action === 'add' ? COLLECT_ITEM_PATH : UNCOLLECT_ITEM_PATH;
    const endpoint = action === 'add' ? COLLECT_ITEM_ENDPOINT : UNCOLLECT_ITEM_ENDPOINT;
    const key = crumbKeyOf(path);
    const url = `${this.baseUrl}${path}`;
    const headers = wishlistHeaders(JSON_ACCEPT, this.baseOrigin);
    const documents: BandcampDocument[] = [];
    const seenCrumbs = new Set<string>();
    let crumb = this.crumbs.get(key) ?? null;
    let source: WishlistCrumbSource = crumb === null ? 'none' : 'cached';
    let writes = 0;
    let pages = 0;
    let pageStatus: number | null = null;
    let status: number | null = null;
    let answer: WishlistWire['answer'] = null;
    let said: string | null = null;
    let redirected = false;
    const seen = (end: WishlistEnd): WishlistWire => ({
      status,
      requests: writes,
      answer,
      end,
      said,
      redirected,
      crumb: source,
      pages,
      pageStatus,
    });
    const rejected = (end: WishlistEnd, detail: string, reason: string | null = null): WishlistWriteOutcome => ({
      ok: false,
      failure: 'bandcamp_rejected',
      detail,
      reason,
      wire: seen(end),
      documents,
    });
    const unreachable = (end: WishlistEnd, detail: string): WishlistWriteOutcome => ({
      ok: false,
      failure: 'bandcamp_unreachable',
      detail,
      reason: null,
      wire: seen(end),
      documents,
    });
    // The path's crumb off the page into memory, or the outcome that ends the press without one.
    const readPage = async (): Promise<string | WishlistWriteOutcome> => {
      pages += 1;
      const page = await this.readCrumbPage(crumbPageOf(item));
      if (page.kind === 'unreachable') return unreachable('page_no_answer', 'the release page did not come back');
      if (page.kind === 'refused') return rejected('page_refused', 'the release page is not an address to fetch');
      documents.push(page.document);
      pageStatus = page.status;
      if (page.status >= 500 || page.status === 429) return unreachable('page_status', `release page HTTP ${page.status}`);
      if (!page.ok) return rejected('page_status', `release page HTTP ${page.status}`);
      for (const value of Object.values(page.crumbs ?? {})) seenCrumbs.add(value);
      if (page.onBandcamp) this.keepCrumbs(page.crumbs);
      const fresh = this.crumbs.get(key);
      if (fresh !== undefined) return fresh;
      const end = !page.onBandcamp ? 'page_off_bandcamp' : page.crumbs === null ? 'no_crumb_map' : 'no_page_crumb';
      return await this.classifyByProbe(documents, seen(end), `the release page carried no ${key} crumb`);
    };

    if (crumb === null) {
      const read = await readPage();
      if (typeof read !== 'string') return read;
      crumb = read;
      source = 'fetched';
    }
    for (let attempt = 0; attempt <= MAX_CRUMB_REPLAYS; attempt += 1) {
      const fetchedAt = nowIso();
      seenCrumbs.add(crumb);
      const wire = await this.send(url, {
        method: 'POST',
        headers,
        body: wishlistRequestBody(item, crumb),
        credentials: 'include',
      });
      if (wire === null) return unreachable('no_answer', 'the request did not come back');
      const parsed = parseJson(wire.text);
      const body = asRecord(parsed);
      const isHtml = wire.contentType.includes('html');
      status = wire.status;
      redirected = redirected || (wire.url !== '' && wire.url !== url);
      answer = body !== undefined ? 'json' : isHtml ? 'html' : 'text';
      const errorText = body === undefined ? undefined : readErrorText(body);
      said = toSaid(body);
      writes += 1;
      const replay = readReplayCrumb(wire.status, body);
      if (replay !== null) seenCrumbs.add(replay);
      const payload = body === undefined ? notJsonPayload(wire.text, isHtml) : parsed;
      documents.push({ endpoint, payload: withoutCrumbs(payload, seenCrumbs), fetchedAt });

      if (replay !== null) this.crumbs.set(key, replay);
      if (replay !== null && attempt < MAX_CRUMB_REPLAYS) {
        crumb = replay;
        continue;
      }
      if (replay !== null) return rejected('crumb_replays_spent', 'invalid_crumb');
      // Read before the status: the crash envelope naming the crumb is a refusal to recover from, whatever its code.
      if (refusesCrumb(body)) {
        this.crumbs.delete(key);
        if (pages === 0 && attempt < MAX_CRUMB_REPLAYS) {
          const read = await readPage();
          if (typeof read !== 'string') return read;
          crumb = read;
          continue;
        }
        return withholdsCrumb(body)
          ? rejected('crumb_withheld', 'invalid_crumb, with no crumb to replay')
          : rejected('crumb_refused', toDetail(errorText ?? 'crumb refused'), readReason(body));
      }
      if (wire.status >= 500 || wire.status === 429) return unreachable('server_status', `HTTP ${wire.status}`);
      if (body === undefined || wire.status === 401) {
        return await this.classifyByProbe(
          documents,
          seen(body === undefined ? 'not_json' : 'http_401'),
          `HTTP ${wire.status}, non-JSON body`,
        );
      }
      if (body.ok === true) return { ok: true, alreadyThere: false, wire: seen('ok'), documents };
      // A crash envelope's `exception` is Bandcamp talking to itself, so its words never read as "already there".
      const crashed = typeof body.exception === 'string' && errorText === body.exception;
      if (errorText !== undefined && !crashed && meansAlreadyThere(errorText, action)) {
        return { ok: true, alreadyThere: true, wire: seen('already_there'), documents };
      }
      return errorText === undefined
        ? rejected('no_ok_field', `HTTP ${wire.status}, a JSON body with neither ok nor an error in it`)
        : rejected('error_text', toDetail(errorText), readReason(body));
    }
    return rejected('crumb_replays_spent', 'invalid_crumb');
  }

  /** A login page, a bare 401 or a page with no crumb could mean signed out or Bandcamp being strange; the probe decides. */
  private async classifyByProbe(
    documents: readonly BandcampDocument[],
    wire: WishlistWire,
    signedInDetail: string,
  ): Promise<WishlistWriteOutcome> {
    const probe = await this.probeIdentity();
    if (probe.kind === 'logged_out') {
      const detail = 'Bandcamp is not signed in on this device';
      return { ok: false, failure: 'logged_out', detail, reason: null, wire, documents };
    }
    if (probe.kind === 'ok') {
      return { ok: false, failure: 'bandcamp_rejected', detail: signedInDetail, reason: null, wire, documents };
    }
    return {
      ok: false,
      failure: 'bandcamp_unreachable',
      detail: `${signedInDetail}, and the sign-in check could not be completed`,
      reason: null,
      wire,
      documents,
    };
  }
}

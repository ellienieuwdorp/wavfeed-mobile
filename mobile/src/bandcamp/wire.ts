/**
 * What every request in the session shares: request-only endpoint names, paths, Accept headers, the answer shape
 * and the fetch-target guard. Ported from extension/lib/bandcamp.ts and server/packages/bandcamp/src; the names Raw
 * Documents carry live in `domain/endpoints.ts` (task 0036, decision 3).
 */
import { asRecord } from '../domain/wire';

export const DEFAULT_BANDCAMP_BASE_URL = 'https://bandcamp.com';

export const COLLECTION_SUMMARY_ENDPOINT = 'collection_summary';
export const COLLECT_ITEM_ENDPOINT = 'collect_item_cb';
export const UNCOLLECT_ITEM_ENDPOINT = 'uncollect_item_cb';
/**
 * The page a wishlist write read its crumb from, stored as `{ url, status, paths }`: the crumb map's keys and never its
 * values, which are session secrets a stored file would hand to anyone holding it (ADR-0003, ADR-0004, ADR-0016).
 * The Projection skips it as an unknown endpoint.
 */
export const CRUMBS_PAGE_ENDPOINT = 'crumbs_page';

export const COLLECTION_SUMMARY_PATH = '/api/fan/2/collection_summary';
export const FEED_UPDATES_PATH = '/fan_dash_feed_updates';
export const FOLLOWING_BANDS_PATH = '/api/fancollection/1/following_bands';
export const WISHLIST_ITEMS_PATH = '/api/fancollection/1/wishlist_items';
export const BAND_DETAILS_PATH = '/api/mobile/24/band_details';
export const COLLECT_ITEM_PATH = '/collect_item_cb';
export const UNCOLLECT_ITEM_PATH = '/uncollect_item_cb';
export const LOGOUT_PATH = '/logout';

export const JSON_ACCEPT = 'application/json, text/javascript, */*; q=0.01';
export const HTML_ACCEPT = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8';
export const FORM_CONTENT_TYPE = 'application/x-www-form-urlencoded';
export const JSON_CONTENT_TYPE = 'application/json';

/** Feed cursors are unix seconds; milliseconds get an HTTP 200 with no stories in it. */
export const MAX_UNIX_SECONDS = 1e11;

export type BandcampDocument = {
  readonly endpoint: string;
  readonly payload: unknown;
  readonly fetchedAt: string;
};

/** `logged_out` is decided from the body; `error.status` is 0 when no HTTP status explains it (ADR-0003). */
export type BandcampAnswer<T> =
  | { readonly kind: 'ok'; readonly value: T }
  | { readonly kind: 'logged_out' }
  | { readonly kind: 'unreachable' }
  | { readonly kind: 'error'; readonly status: number };

export type Identity = {
  readonly fanId: number;
  readonly username: string | null;
};

/** A response as the session reads it; `contentType` is lowercased. */
export type Wire = {
  readonly status: number;
  readonly ok: boolean;
  readonly contentType: string;
  readonly url: string;
  readonly text: string;
};

/** Bandcamp asking for fewer requests; the Sweep breaker opens on one (ADR-0017). */
export const REFUSAL_STATUSES: readonly number[] = [403, 429];

export function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

/**
 * The only place logged-out is decided: signed in means JSON with a numeric `fan_id`. A 5xx or a refusal status is
 * Bandcamp's state, not the session's, so it answers `error` with the status and pauses nothing.
 */
export function readProbe(wire: Wire | null): BandcampAnswer<Identity> {
  if (wire === null) return { kind: 'unreachable' };
  if (wire.status >= 500 || REFUSAL_STATUSES.includes(wire.status)) return { kind: 'error', status: wire.status };
  if (!wire.ok || !wire.contentType.includes('json')) return { kind: 'logged_out' };

  const body = asRecord(parseJson(wire.text));
  const fanId = body?.fan_id;
  if (body === undefined || typeof fanId !== 'number' || !Number.isFinite(fanId)) return { kind: 'logged_out' };
  const summary = asRecord(body.collection_summary);
  const username = [body.username, summary?.username].find(
    (value): value is string => typeof value === 'string' && value !== '',
  );
  return { kind: 'ok', value: { fanId, username: username ?? null } };
}

export function formBody(fields: Readonly<Record<string, string>>): string {
  return Object.entries(fields)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&');
}

const AUTHORITY = /^([a-z][a-z0-9+.-]*):\/\/([^/?#]*)/i;
const LOCAL_SUFFIX = /\.(local|internal|localhost|ts\.net)$/;
const NUMERIC_LABEL = /^(\d+|0x[0-9a-f]*)$/;

/** Read by hand: React Native's `URL` never refuses input. */
export function originOf(url: string): string | null {
  const match = AUTHORITY.exec(url);
  if (match?.[1] === undefined || match[2] === undefined) return null;
  return `${match[1].toLowerCase()}://${match[2].toLowerCase()}`;
}

/**
 * The server's fetch-target guard less its DNS half (audit S1): the session's origin passes, anything else must be
 * https on a public host name with no credentials, port or IP literal.
 * ceiling: no lookup, so a public name resolving to a private address passes; upgrade to a native resolver check.
 */
export function isFetchableTarget(url: string, baseOrigin: string): boolean {
  const origin = originOf(url);
  if (origin === null) return false;
  if (origin === baseOrigin) return true;
  if (!origin.startsWith('https://')) return false;
  const host = origin.slice('https://'.length).replace(/:443$/, '').replace(/\.$/, '');
  if (!/^[a-z0-9.-]+$/.test(host) || !host.includes('.') || LOCAL_SUFFIX.test(host)) return false;
  return !NUMERIC_LABEL.test(host.slice(host.lastIndexOf('.') + 1));
}

/**
 * bandcamp.com or one of its subdomains over https: the hosts the jar sends the Fan's session to, so the only pages
 * whose crumb map speaks for that session (ADR-0016 amendment 2026-09-28). A custom domain gets none of its cookies.
 */
export function onBandcampHost(url: string): boolean {
  const origin = originOf(url);
  if (origin === null || !origin.startsWith('https://')) return false;
  const host = origin.slice('https://'.length).replace(/:443$/, '').replace(/\.$/, '');
  return /^[a-z0-9.-]+$/.test(host) && (host === 'bandcamp.com' || host.endsWith('.bandcamp.com'));
}

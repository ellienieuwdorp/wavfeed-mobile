/**
 * The reading half of the wishlist exchange (ADR-0016): the request body and headers, the crumb map a signed-in page
 * carries in `<meta id="js-crumbs-data">` (amendment 2026-09-28), the crumb an `invalid_crumb` answer hands back, and
 * every answer classified from its body. A signed-out answer is `logged_out`, since the phone holds no cookie. The headers are the ones that land on the real wire, plus the charset jQuery adds (docs/research/2026-08-21-wishlist-wire.md). A
 * handler that throws answers with Bandcamp's trackpipe envelope (`error`, `exception`, `host`, `url`, `date`, `user`),
 * and its own client shows the person only what follows `ALERT: ` in `exception` (`showXHRError`, global_foot2), so
 * that is the reason a refusal carries, and the whole exception when there is no such marker.
 */
import type { ItemType } from '../domain/types';
import { decodeHtmlEntities } from './htmlBlob';
import { type BandcampDocument, formBody, parseJson } from './wire';

/** Replays after a refused crumb, the two the site allows itself: three writes at most. */
export const MAX_CRUMB_REPLAYS = 2;
export const FAILURE_DETAIL_MAX_CHARS = 200;
/** How much of the answer's shape the press log line carries: eight fields with one reason at `REASON_MAX_CHARS` fit. */
export const SAID_MAX_CHARS = 256;
const SHAPE_MAX_KEYS = 8;
const REASON_MAX_CHARS = 96;
/** What jQuery sends for a plain-object `data` on the site's heart. */
export const WISHLIST_CONTENT_TYPE = 'application/x-www-form-urlencoded; charset=UTF-8';
/** Without it iOS sends the device's languages. */
export const WISHLIST_ACCEPT_LANGUAGE = 'en-US,en;q=0.9';
/** Where Bandcamp's envelope starts the words its client shows the person as a note, not as a crash. */
const ALERT_MARKER = 'ALERT: ';

export type WishlistWriteKind = 'add' | 'remove';

/**
 * Ids are strings, bigints on the wire; `bandId` is the Release's `band_id`, not `selling_band_id`. `releaseUrl` is the
 * Release's own page, the one the site's heart reads its crumb from (research doc, "The crumb"). `standInUrl` is the
 * page of another Release the store holds on a bandcamp.com host, read in its place when `releaseUrl` is on a custom
 * domain, or null when none is held (ADR-0016 amendment 2026-09-28).
 */
export type WishlistItem = {
  readonly fanId: number;
  readonly itemType: ItemType;
  readonly itemId: string;
  readonly bandId: string;
  readonly releaseUrl: string;
  readonly standInUrl: string | null;
};

export type WishlistFailure = 'logged_out' | 'bandcamp_rejected' | 'bandcamp_unreachable';

/** Which rule decided the outcome, a fixed word the press log can carry without any of the body. */
export type WishlistEnd =
  | 'ok'
  | 'already_there'
  | 'no_answer'
  | 'server_status'
  | 'crumb_replays_spent'
  | 'crumb_withheld'
  | 'crumb_refused'
  | 'no_page_crumb'
  | 'no_crumb_map'
  | 'page_off_bandcamp'
  | 'page_no_answer'
  | 'page_status'
  | 'page_refused'
  | 'not_json'
  | 'http_401'
  | 'error_text'
  | 'no_ok_field';

/** Where the first write's crumb came from: memory, the Release's page read for this press, or nowhere. */
export type WishlistCrumbSource = 'cached' | 'fetched' | 'none';

/**
 * What the exchange looked like on the wire: the last write's status, the writes answered, the last body's kind and its
 * shape from `answerShape`, cut to `SAID_MAX_CHARS`. `redirected` is an answer from another URL than the one asked,
 * which `fetch` reaches on a 301 or 302 by resending the POST as a GET without its body. `crumb` names the first
 * write's crumb source and never its value; `pages` counts the crumb page reads and `pageStatus` is the last one's
 * status, so `cached` with a page read is a refused crumb read again.
 */
export type WishlistWire = {
  readonly status: number | null;
  readonly requests: number;
  readonly answer: 'json' | 'html' | 'text' | null;
  readonly end: WishlistEnd;
  readonly said: string | null;
  readonly redirected: boolean;
  readonly crumb: WishlistCrumbSource;
  readonly pages: number;
  readonly pageStatus: number | null;
};

/** Every response comes back with the outcome, for the caller to store before acting on it (ADR-0004). */
export type WishlistWriteOutcome =
  | {
      readonly ok: true;
      readonly alreadyThere: boolean;
      readonly wire: WishlistWire;
      readonly documents: readonly BandcampDocument[];
    }
  | {
      readonly ok: false;
      readonly failure: WishlistFailure;
      readonly detail: string;
      /** Bandcamp's own words from `readReason`, null when it answered with a flag, a crumb or nothing. */
      readonly reason: string | null;
      readonly wire: WishlistWire;
      readonly documents: readonly BandcampDocument[];
    };

const CRUMB_REPLY_STATUSES: readonly number[] = [200, 403];
const SENSITIVE_ASSIGNMENT =
  /("?)\b(identity|cookie|set-cookie|authorization|crumb)\b\1(\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s;,"']+)/gi;
/** What a secret's value is stored and logged as. */
const REDACTED = '[redacted]';
/** A crumb as Bandcamp writes one, `|path|seconds|signature`, wherever it sits in a text. */
const CRUMB_VALUE = /\|[\w./-]+\|\d+\|[A-Za-z0-9+/=]+/g;
const CRUMB_FIELD = /crumb/i;

export function wishlistRequestBody(item: WishlistItem, crumb: string | null): string {
  return formBody({
    fan_id: String(item.fanId),
    item_id: item.itemId,
    item_type: item.itemType,
    band_id: item.bandId,
    ...(crumb === null ? {} : { crumb }),
  });
}

/**
 * Origin and Referer name the site itself: without one of them Bandcamp's handler now throws "expected either an
 * origin or referrer header" (seen on the phone 2026-09-28), where the site's own heart sends both from the page.
 */
export function wishlistHeaders(accept: string, origin: string): Record<string, string> {
  return {
    Accept: accept,
    Origin: origin,
    Referer: `${origin}/`,
    'Accept-Language': WISHLIST_ACCEPT_LANGUAGE,
    'Content-Type': WISHLIST_CONTENT_TYPE,
    'X-Requested-With': 'XMLHttpRequest',
  };
}

/** `invalid_crumb` with no fresh crumb in it: Bandcamp refused the request before it would hand one over. */
export function withholdsCrumb(body: Record<string, unknown> | undefined): boolean {
  return body?.error === 'invalid_crumb' && (typeof body.crumb !== 'string' || body.crumb === '');
}

export function readReplayCrumb(status: number, body: Record<string, unknown> | undefined): string | null {
  if (!CRUMB_REPLY_STATUSES.includes(status) || body === undefined) return null;
  if (body.error !== 'invalid_crumb') return null;
  return typeof body.crumb === 'string' && body.crumb !== '' ? body.crumb : null;
}

/**
 * A write refused for its crumb with no fresh one to replay: `invalid_crumb` bare, or the crash envelope whose words
 * name the crumb ("old or no crumb specified for request to /collect_item", seen on the phone 2026-09-28).
 */
export function refusesCrumb(body: Record<string, unknown> | undefined): boolean {
  if (body === undefined) return false;
  if (withholdsCrumb(body)) return true;
  const words = readWords(body);
  return words !== undefined && /crumb/i.test(words);
}

/** The key the site's `Crumb.ajax` reads a path's crumb under: the path less its leading slash (global_foot2). */
export function crumbKeyOf(path: string): string {
  return path.replace(/^\/+/, '');
}

const CRUMBS_ELEMENT_ID = 'js-crumbs-data';
const CRUMBS_ATTRIBUTE = 'data-crumbs';
/** One start tag, sticky from its `<`, whose quoted values may hold a `>`. */
const START_TAG = /<[a-z][a-z0-9-]*(?:[^>"']|"[^"]*"|'[^']*')*>/iy;
const ATTRIBUTE = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
const ENTITY = /&(#[0-9]+|#x[0-9a-f]+|[a-z]+);/gi;

/** One pass, so `&amp;quot;` stays `&quot;`: numeric references here, named ones through `decodeHtmlEntities`. */
function decodeAttribute(value: string): string {
  return value.replace(ENTITY, (entity: string, name: string) => {
    if (!name.startsWith('#')) return decodeHtmlEntities(entity);
    const hex = name[1] === 'x' || name[1] === 'X';
    const code = Number.parseInt(name.slice(hex ? 2 : 1), hex ? 16 : 10);
    return Number.isInteger(code) && code <= 0x10ffff ? String.fromCodePoint(code) : entity;
  });
}

/** A start tag's attributes, names lowercased and values decoded; the first of a repeated name wins, as in HTML. */
function readAttributes(tag: string): ReadonlyMap<string, string> {
  const attributes = new Map<string, string>();
  const inner = tag.replace(/^<[a-z][a-z0-9-]*/i, '').replace(/\/?>$/, '');
  for (const match of inner.matchAll(ATTRIBUTE)) {
    const name = match[1]?.toLowerCase();
    if (name === undefined || attributes.has(name)) continue;
    attributes.set(name, decodeAttribute(match[2] ?? match[3] ?? match[4] ?? ''));
  }
  return attributes;
}

/**
 * The page's crumb map as the site's `global_head` reads it (`JSON.parse(n.dataset.crumbs)`): request path less its
 * leading slash to crumb, `{}` for a signed-out page. Either quote style, any attribute order, entities decoded; only
 * non-empty string values are kept. Undefined when no `#js-crumbs-data` element is found, null when its attribute is
 * missing or not a JSON object. The values are secrets: nothing here or after it logs or stores one (ADR-0003).
 */
export function readPageCrumbs(html: string): Readonly<Record<string, string>> | null | undefined {
  for (let at = html.indexOf(CRUMBS_ELEMENT_ID); at >= 0; at = html.indexOf(CRUMBS_ELEMENT_ID, at + 1)) {
    const open = html.lastIndexOf('<', at);
    if (open < 0) continue;
    START_TAG.lastIndex = open;
    const tag = START_TAG.exec(html)?.[0];
    if (tag === undefined || open + tag.length <= at) continue;
    const attributes = readAttributes(tag);
    if (attributes.get('id') !== CRUMBS_ELEMENT_ID) continue;
    const raw = attributes.get(CRUMBS_ATTRIBUTE);
    const parsed = raw === undefined ? undefined : parseJson(raw);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const crumbs: Record<string, string> = {};
    for (const [path, crumb] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof crumb === 'string' && crumb !== '') crumbs[path] = crumb;
    }
    return crumbs;
  }
  return undefined;
}

const REASON_KEYS: readonly string[] = ['error_message', 'exception', 'error', 'message', 'msg', 'reason'];
const FLAG_KEYS: readonly string[] = ['error_message', 'error'];
const SECRET_KEY = /crumb|identity|cookie|token|session|auth/i;

function readWords(body: Record<string, unknown>): string | undefined {
  for (const key of REASON_KEYS) {
    const value = body[key];
    if (typeof value === 'string' && value.trim() !== '') return value;
  }
  return undefined;
}

/** The first reason Bandcamp put in words, else the name of a bare `true` flag. */
export function readErrorText(body: Record<string, unknown>): string | undefined {
  return readWords(body) ?? FLAG_KEYS.find((key) => body[key] === true);
}

/** Bandcamp's words for the person, scrubbed: what follows `ALERT: ` when the envelope marks one, else all of them. */
export function readReason(body: Record<string, unknown> | undefined): string | null {
  const words = body === undefined ? undefined : readWords(body);
  if (words === undefined) return null;
  const alert = words.indexOf(ALERT_MARKER);
  const reason = toDetail(alert < 0 ? words : words.slice(alert + ALERT_MARKER.length));
  return reason === '' ? null : reason;
}

function shapeOf(key: string, value: unknown): string {
  if (value === null) return 'null';
  if (SECRET_KEY.test(key)) return Array.isArray(value) ? 'list' : typeof value;
  if (typeof value === 'boolean' || typeof value === 'number') return String(value);
  if (typeof value === 'string') {
    return REASON_KEYS.includes(key) ? `'${toDetail(value).slice(0, REASON_MAX_CHARS)}'` : `text${value.length}`;
  }
  if (Array.isArray(value)) return `list${value.length}`;
  return typeof value === 'object' ? `{${Object.keys(value).slice(0, 4).join(',')}}` : typeof value;
}

/**
 * The answer's top-level fields for the press log: every name, and a value only for a flag, a number or a reason
 * field; a field named like a secret gives its type alone.
 */
export function answerShape(body: Record<string, unknown>): string {
  const entries = Object.entries(body);
  const shown = entries.slice(0, SHAPE_MAX_KEYS).map(([key, value]) => `${key}:${shapeOf(key, value)}`);
  return [...shown, ...(entries.length > SHAPE_MAX_KEYS ? [`+${entries.length - SHAPE_MAX_KEYS}`] : [])].join(' ');
}

const OWNED_WORDS = /\b(own|owned|purchased|in your collection)\b/;

/**
 * No documented "already there" answer exists, so any error text saying "already" is taken as one, and for an add a
 * text saying the Fan owns the item too: an owned item's heart reads as on (DESIGN-UI section 12).
 */
export function meansAlreadyThere(errorText: string, action: WishlistWriteKind): boolean {
  const text = errorText.toLowerCase();
  return text.includes('already') || (action === 'add' && OWNED_WORDS.test(text));
}

export function toDetail(text: string): string {
  return text
    .replace(SENSITIVE_ASSIGNMENT, (_m, q: string, key: string, sep: string) => `${q}${key}${q}${sep}${REDACTED}`)
    .replace(CRUMB_VALUE, REDACTED)
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, FAILURE_DETAIL_MAX_CHARS);
}

/** The answer's shape for the log line: scrubbed like the detail, and one line. */
export function toSaid(body: Record<string, unknown> | undefined): string | null {
  if (body === undefined) return null;
  return answerShape(body).replace(/\s+/g, ' ').slice(0, SAID_MAX_CHARS).replace(/"/g, "'");
}

/** The payload a non-JSON answer is kept under, whole. */
export function notJsonPayload(text: string, isHtml: boolean): unknown {
  return isHtml ? { html: text } : { text };
}

/**
 * A write's answer as it is stored and returned (ADR-0003, ADR-0016 amendment 2026-09-28): a string field named like a
 * crumb keeps its name with `[redacted]` for its value, and every crumb in `seen` or shaped like one is cut out of the
 * text, so an `invalid_crumb` answer or a signed-in page never lands a session secret in `raw_documents`.
 */
export function withoutCrumbs(value: unknown, seen: ReadonlySet<string>): unknown {
  if (typeof value === 'string') {
    let text = value;
    for (const crumb of seen) if (crumb !== '') text = text.split(crumb).join(REDACTED);
    return text.replace(CRUMB_VALUE, REDACTED);
  }
  if (Array.isArray(value)) return value.map((entry) => withoutCrumbs(entry, seen));
  if (typeof value !== 'object' || value === null) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      CRUMB_FIELD.test(key) && typeof entry === 'string' && entry !== '' ? REDACTED : withoutCrumbs(entry, seen),
    ]),
  );
}

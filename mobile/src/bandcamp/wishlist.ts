/**
 * The reading half of the wishlist exchange (ADR-0016): the request body and headers, the crumb an `invalid_crumb`
 * answer hands back, and every answer classified from its body. Ported from server/packages/bandcamp/src/wishlist.ts,
 * with `cookie_dead` renamed `logged_out` because the phone holds no cookie (task 0036, decision 1). The headers are the
 * server's, which lands on the real wire, plus the charset jQuery adds (docs/research/2026-08-21-wishlist-wire.md).
 */
import type { ItemType } from '../domain/types';
import { type BandcampDocument, formBody } from './wire';

/** Replays after `invalid_crumb`, the two the site allows itself: three requests at most. */
export const MAX_CRUMB_REPLAYS = 2;
export const FAILURE_DETAIL_MAX_CHARS = 200;
/** How much of the answer's shape the press log line carries. */
export const SAID_MAX_CHARS = 160;
const SHAPE_MAX_KEYS = 8;
const REASON_MAX_CHARS = 48;
/** What jQuery sends for a plain-object `data` on the site's heart. */
export const WISHLIST_CONTENT_TYPE = 'application/x-www-form-urlencoded; charset=UTF-8';

export type WishlistWriteKind = 'add' | 'remove';

/** Ids are strings, bigints on the wire; `bandId` is the Release's `band_id`, not `selling_band_id`. */
export type WishlistItem = {
  readonly fanId: number;
  readonly itemType: ItemType;
  readonly itemId: string;
  readonly bandId: string;
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
  | 'not_json'
  | 'http_401'
  | 'error_text'
  | 'no_ok_field';

/**
 * What the exchange looked like on the wire: the last write's status, the writes sent, the last body's kind and its
 * shape from `answerShape`, cut to `SAID_MAX_CHARS`.
 */
export type WishlistWire = {
  readonly status: number | null;
  readonly requests: number;
  readonly answer: 'json' | 'html' | 'text' | null;
  readonly end: WishlistEnd;
  readonly said: string | null;
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
      readonly wire: WishlistWire;
      readonly documents: readonly BandcampDocument[];
    };

const CRUMB_REPLY_STATUSES: readonly number[] = [200, 403];
const SENSITIVE_ASSIGNMENT =
  /("?)\b(identity|cookie|set-cookie|authorization|crumb)\b\1(\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s;,"']+)/gi;

export function wishlistRequestBody(item: WishlistItem, crumb: string | null): string {
  return formBody({
    fan_id: String(item.fanId),
    item_id: item.itemId,
    item_type: item.itemType,
    band_id: item.bandId,
    ...(crumb === null ? {} : { crumb }),
  });
}

/** No Origin and no Referer: the server's write sends neither and lands. */
export function wishlistHeaders(accept: string): Record<string, string> {
  return { Accept: accept, 'Content-Type': WISHLIST_CONTENT_TYPE, 'X-Requested-With': 'XMLHttpRequest' };
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

const REASON_KEYS: readonly string[] = ['error_message', 'error', 'message', 'msg', 'reason'];
const FLAG_KEYS: readonly string[] = ['error_message', 'error'];
const SECRET_KEY = /crumb|identity|cookie|token|session|auth/i;

/** The first reason Bandcamp put in words, else the name of a bare `true` flag. */
export function readErrorText(body: Record<string, unknown>): string | undefined {
  for (const key of REASON_KEYS) {
    const value = body[key];
    if (typeof value === 'string' && value.trim() !== '') return value;
  }
  return FLAG_KEYS.find((key) => body[key] === true);
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
 * field; a field named like a secret gives its type alone (task 0036, decision 1).
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
    .replace(SENSITIVE_ASSIGNMENT, (_m, q: string, key: string, sep: string) => `${q}${key}${q}${sep}[redacted]`)
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

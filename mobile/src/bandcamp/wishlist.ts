/**
 * The reading half of the wishlist exchange (ADR-0016): the request body, the crumb an `invalid_crumb` answer hands
 * back, and every answer classified from its body. Ported from server/packages/bandcamp/src/wishlist.ts, with
 * `cookie_dead` renamed `logged_out` because the phone holds no cookie (task 0036, decision 1).
 */
import type { ItemType } from '../domain/types';
import { type BandcampDocument, formBody } from './wire';

/** Replays after `invalid_crumb`, the two the site allows itself: three requests at most. */
export const MAX_CRUMB_REPLAYS = 2;
export const FAILURE_DETAIL_MAX_CHARS = 200;

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
  | 'not_json'
  | 'http_401'
  | 'error_text'
  | 'no_ok_field';

/** What the exchange looked like on the wire: the last write's status, the writes sent and the last body's kind. */
export type WishlistWire = {
  readonly status: number | null;
  readonly requests: number;
  readonly answer: 'json' | 'html' | 'text' | null;
  readonly end: WishlistEnd;
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

export function readReplayCrumb(status: number, body: Record<string, unknown> | undefined): string | null {
  if (!CRUMB_REPLY_STATUSES.includes(status) || body === undefined) return null;
  if (body.error !== 'invalid_crumb') return null;
  return typeof body.crumb === 'string' && body.crumb !== '' ? body.crumb : null;
}

export function readErrorText(body: Record<string, unknown>): string | undefined {
  for (const key of ['error_message', 'error']) {
    const value = body[key];
    if (typeof value === 'string' && value.trim() !== '') return value;
    if (typeof value === 'boolean' && value) return key;
  }
  return undefined;
}

/** No documented "already there" answer exists, so any error text saying "already" is taken as one. */
export function meansAlreadyThere(errorText: string): boolean {
  return errorText.toLowerCase().includes('already');
}

export function toDetail(text: string): string {
  return text
    .replace(SENSITIVE_ASSIGNMENT, (_m, q: string, key: string, sep: string) => `${q}${key}${q}${sep}[redacted]`)
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, FAILURE_DETAIL_MAX_CHARS);
}

/** The payload a non-JSON answer is kept under, whole. */
export function notJsonPayload(text: string, isHtml: boolean): unknown {
  return isHtml ? { html: text } : { text };
}

/// <reference types="node" />
/**
 * A gather turn's world for the turn tests: the phone's own sink and store against a Bandcamp that serves purchase
 * Stories newest first behind the feed's `older_than` cursor, and release and Track pages by key. Each request costs
 * the clock a second. A test file calls `beforeEach(resetRig)` and sets what it needs on `rig`.
 */
import type { SQLiteDatabase } from 'expo-sqlite';

import { FAN_ID, feedPayload, followingBandsFirstPage, purchaseAt, releasePagePayload } from './fixtures';
import { openTestStore } from './nodeDb';
import type { BandcampAnswer, Identity } from '../src/bandcamp/wire';
import type { BandDetails, FeedUpdatesPage, ReleasePage } from '../src/bandcamp/session';
import { createGatherSink } from '../src/state/gatherSink';
import { fold } from '../src/store/projection';
import { insertRawDocument } from '../src/store/rawDocuments';
import { EMPTY_GATHER_STATE, type GatherSink, type GatherState } from '../src/fetcher/sink';
import { type GatherReason, type GatherSession, runGatherTurn } from '../src/fetcher/turn';

export const START = Date.UTC(2026, 8, 25, 12, 0, 0);
export const PAGE_SIZE = 5;
export const REQUEST_MS = 1_000;
export const FAN: Identity = { fanId: FAN_ID, username: 'diggerfan' };
export const OTHER_FAN: Identity = { fanId: FAN_ID + 1, username: 'mara.dj' };
export const START_S = Math.floor(START / 1000);
export const DAY_S = 86_400;

export type Story = { readonly itemId: number; readonly at: number };

/** `count` Stories `stepS` apart, the newest `newestAgoS` seconds before START; item ids from `firstId` up. */
export function stories(count: number, firstId: number, newestAgoS = 3600, stepS = 60): Story[] {
  const newest = START_S - newestAgoS;
  return Array.from({ length: count }, (_, i) => ({ itemId: firstId + i, at: newest - stepS * i }));
}

/** `count` Stories a day apart, the newest on the given UTC day. */
export function daily(count: number, firstId: number, year: number, month: number, day: number): Story[] {
  return stories(count, firstId, START_S - Date.UTC(year, month, day) / 1000, DAY_S);
}

export const ok = <T>(value: T): BandcampAnswer<T> => ({ kind: 'ok', value });

export const at = (): string => new Date(rig.clock).toISOString();

const session: GatherSession = {
  async probeIdentity() {
    rig.probes += 1;
    return rig.probe;
  },
  async pokeFeedPage(username) {
    rig.clock += rig.pokeMs;
    return ok({ endpoint: 'fan_feed_page', payload: { url: `/${username}/feed`, status: 200, bytes: 0 }, fetchedAt: at() });
  },
  async fetchWishlistItems(_fanId, onDocument) {
    rig.asked.push('wishlist');
    if (rig.wishlisted.length > 0) {
      const inputToken = `${Math.floor(rig.clock / 1000)}::a::`;
      await onDocument({
        endpoint: 'wishlist_items', fetchedAt: at(),
        payload: {
          snapshot_started_at: at(), request: { fan_id: FAN.fanId, older_than_token: inputToken },
          response: { items: rig.wishlisted.map((itemId) => ({ tralbum_type: 'a', tralbum_id: itemId })), more_available: !rig.listsComplete, last_token: 'next' },
          snapshotPage: { number: 1, inputToken, nextToken: rig.listsComplete ? null : 'next' },
        },
      });
    }
    return ok({ pages: rig.wishlisted.length > 0 ? 1 : 0, seen: rig.wishlisted.length, complete: rig.listsComplete });
  },
  async fetchFollowingBands(_fanId, _username, onDocument) {
    rig.asked.push('follows');
    if (rig.followed.length === 0) return ok({ pages: 0, seen: 0, complete: rig.listsComplete });
    rig.clock += REQUEST_MS;
    const payload = followingBandsFirstPage(rig.followed, at());
    if (!rig.listsComplete) {
      payload.followingBands = { ...(payload.followingBands as Record<string, unknown>), following_bands: { item_count: rig.followed.length + 1, last_token: 'next' } };
    }
    await onDocument({ endpoint: 'following_bands', payload, fetchedAt: at() });
    return ok({ pages: 1, seen: rig.followed.length, complete: rig.listsComplete });
  },
  async fetchBandDetails(bandId) {
    rig.clock += REQUEST_MS;
    rig.bandDetailsAsked.push(bandId);
    return rig.bandDetails;
  },
  async fetchFeedUpdates(_fanId, olderThan): Promise<BandcampAnswer<FeedUpdatesPage>> {
    rig.clock += REQUEST_MS;
    rig.asked.push('feed');
    rig.cursors.push(olderThan);
    const refusal = rig.refuseFeed(rig.cursors.length - 1);
    if (refusal !== null) return refusal;
    const cursor = rig.replayFloor === null ? olderThan : Math.max(olderThan, rig.replayFloor);
    const page = rig.feed.filter((story) => story.at < cursor).sort((a, b) => b.at - a.at).slice(0, PAGE_SIZE);
    const dates = page.map((story) => story.at);
    const oldestStoryDate = page.length === 0 ? undefined : Math.min(...dates);
    const newestStoryDate = page.length === 0 ? undefined : Math.max(...dates);
    const payload = feedPayload({ entries: page.map((story) => purchaseAt(story.itemId, story.at)), oldestStoryDate, newestStoryDate });
    return ok({
      document: { endpoint: 'fan_dash_feed_updates', payload, fetchedAt: at() },
      entryCount: page.length,
      oldestStoryDate: oldestStoryDate ?? null,
      newestStoryDate: newestStoryDate ?? null,
    });
  },
  async fetchReleasePage(url, key) {
    rig.clock += REQUEST_MS;
    rig.releasePages.push(key.itemId);
    rig.releasePageUrls.push(url);
    return rig.releasePage(key.itemId, key.itemType);
  },
};

/** Bandcamp signing the phone out mid-turn: the feed's answer and every probe after it say so. */
export function signOut(): BandcampAnswer<never> {
  rig.probe = { kind: 'logged_out' };
  return { kind: 'logged_out' };
}

export function datedPage(itemId: number): BandcampAnswer<ReleasePage> {
  return ok({ kind: 'page', document: { endpoint: 'release_page', payload: releasePagePayload({ itemId }), fetchedAt: at() } });
}

export function turn(budgetMs = 600_000, reason: GatherReason = 'open') {
  const wait = async (ms: number) => {
    rig.clock += ms;
  };
  return runGatherTurn(session, rig.sink, { now: () => rig.clock, reason, budgetMs, wait });
}

export async function followBands(bandIds: readonly number[]): Promise<void> {
  const follows = Object.fromEntries(bandIds.map((bandId) => [String(bandId), { band_id: bandId }]));
  const followingBands = { item_cache: { following_bands: follows }, following_bands: { item_count: bandIds.length } };
  await insertRawDocument(rig.db, { endpoint: 'following_bands', payload: { fanId: FAN.fanId, page: 1, snapshotStartedAt: at(), followingBands }, fetchedAt: at() });
  await fold(rig.db);
}

export async function storyCount(): Promise<number> {
  return (await rig.db.getFirstAsync<{ n: number }>('select count(*) as n from stories'))?.n ?? 0;
}

/** The state the fake Bandcamp and every test read and set, fresh from `resetRig`. */
type Rig = {
  db: SQLiteDatabase;
  sink: GatherSink;
  gather: GatherState;
  clock: number;
  feed: Story[];
  /** Bandcamp answers any cursor older than this as if it were this: the same window again. */
  replayFloor: number | null;
  cursors: number[];
  releasePages: number[];
  releasePageUrls: string[];
  bandDetailsAsked: number[];
  bandDetails: BandcampAnswer<BandDetails>;
  probe: BandcampAnswer<Identity>;
  probes: number;
  /** A refusal for the feed request with this index in `cursors`, or null to answer it. */
  refuseFeed: (asked: number) => BandcampAnswer<never> | null;
  releasePage: (itemId: number, itemType: 'a' | 't') => BandcampAnswer<ReleasePage>;
  /** Followed Pages the follow list answers with, as one stored page; none answers with no page. */
  followed: readonly number[];
  wishlisted: readonly number[];
  listsComplete: boolean;
  /** What the poke costs the clock; none unless a test sets it. */
  pokeMs: number;
  /** The lists and the feed, each named once per request, in the order the turn asked them. */
  asked: ('wishlist' | 'follows' | 'feed')[];
};
// Each field is set by resetRig before a test reads it.
export const rig = {} as Rig;

export async function resetRig(): Promise<void> {
  ({ db: rig.db } = await openTestStore());
  rig.gather = EMPTY_GATHER_STATE;
  rig.sink = createGatherSink({ db: rig.db, setGather: (state) => (rig.gather = state), invalidate: () => undefined });
  rig.clock = START;
  rig.feed = [];
  rig.replayFloor = null;
  rig.cursors = [];
  rig.releasePages = [];
  rig.releasePageUrls = [];
  rig.bandDetailsAsked = [];
  rig.bandDetails = { kind: 'error', status: 429 };
  rig.probe = ok(FAN);
  rig.probes = 0;
  rig.refuseFeed = () => null;
  rig.releasePage = datedPage;
  rig.followed = [];
  rig.wishlisted = [];
  rig.listsComplete = true;
  rig.pokeMs = 0;
  rig.asked = [];
}

/**
 * Scripted gather turns against a fake session and an in-memory sink, printing
 * every request, the walk state after each page and the final GatherState
 * (task 0036): a first walk, a poll, and a walk that runs out of budget and
 * keeps time for release pages (ADR-0011). No request leaves the machine. Run: `npx tsc --outDir /tmp/wfturn ...` then
 * `node /tmp/wfturn/fetcher/__checks__/turn.check.js`.
 */
import type { BandcampAnswer, BandcampDocument, Identity } from '../../bandcamp/wire';
import type { BandDetails, FeedUpdatesPage, ListWalk, OnDocument, ReleasePage } from '../../bandcamp/session';
import type { ReleaseKey } from '../../domain/endpoints';
import type { UndatedRelease } from '../../store/enrichment';
import { EMPTY_GATHER_STATE, type GatherSink, type GatherState, type SweepBooking, type WalkState } from '../sink';
import { type GatherSession, runGatherTurn } from '../turn';

const NOW = Date.UTC(2026, 8, 25, 12, 0, 0);
const at = new Date(NOW).toISOString();

function feedPage(oldest: number, newest: number, ids: number[]): FeedUpdatesPage {
  const payload = { stories: { entries: ids.map((id) => ({ story_id: id })), oldest_story_date: oldest, newest_story_date: newest } };
  return { document: { endpoint: 'fan_dash_feed_updates', payload, fetchedAt: at }, entryCount: ids.length, oldestStoryDate: oldest, newestStoryDate: newest };
}

// The third page repeats the second: same bytes, same window.
const pages = [feedPage(1790300000, 1790330000, [1, 2, 3]), feedPage(1790200000, 1790290000, [4, 5, 6])];
pages.push(pages[1] ?? feedPage(0, 0, []));

let feedCalls = 0;
let clock = NOW;
/** Milliseconds each request costs the clock; 0 keeps the first two turns inside any budget. */
let requestCostMs = 0;
let endlessFeed = false;

function tick(): void {
  clock += requestCostMs;
}

const undated: UndatedRelease[] = [
  { itemType: 'a', itemId: 101, url: 'https://page-one.bandcamp.com/album/dated' },
  { itemType: 'a', itemId: 102, url: 'https://page-one.bandcamp.com/album/gone' },
  { itemType: 't', itemId: 103, url: 'https://page-two.bandcamp.com/track/no-date' },
];
const attempted = new Map<string, number>();

const session: GatherSession = {
  async probeIdentity(): Promise<BandcampAnswer<Identity>> {
    return { kind: 'ok', value: { fanId: 42, username: 'fan42' } };
  },
  async pokeFeedPage(username: string): Promise<BandcampAnswer<BandcampDocument>> {
    return { kind: 'ok', value: { endpoint: 'fan_feed_page', payload: { url: `/${username}/feed`, html: '<html></html>' }, fetchedAt: at } };
  },
  async fetchFeedUpdates(fanId: number, olderThan: number): Promise<BandcampAnswer<FeedUpdatesPage>> {
    tick();
    const step = 10_000 * (feedCalls + 1);
    const page = endlessFeed ? feedPage(olderThan - step, olderThan - 1, [feedCalls * 10 + 1]) : pages[feedCalls];
    feedCalls += 1;
    console.log(`  request: fan_dash_feed_updates fan_id=${fanId} older_than=${olderThan}`);
    return page === undefined ? { kind: 'error', status: 0 } : { kind: 'ok', value: page };
  },
  async fetchFollowingBands(fanId: number, _username: string, onDocument: OnDocument): Promise<BandcampAnswer<ListWalk>> {
    await onDocument({ endpoint: 'following_bands', payload: { fanId, page: 1, followingBands: {} }, fetchedAt: at });
    return { kind: 'ok', value: { pages: 1, seen: 2, complete: true } };
  },
  async fetchWishlistItems(fanId: number, onDocument: OnDocument): Promise<BandcampAnswer<ListWalk>> {
    await onDocument({ endpoint: 'wishlist_items', payload: { request: { fan_id: fanId }, response: { items: [] } }, fetchedAt: at });
    return { kind: 'ok', value: { pages: 1, seen: 0, complete: true } };
  },
  async fetchReleasePage(itemUrl: string, key: ReleaseKey): Promise<BandcampAnswer<ReleasePage>> {
    tick();
    console.log(`  request: release_page ${key.itemType}:${key.itemId} ${itemUrl}`);
    if (key.itemId === 102) return { kind: 'ok', value: { kind: 'gone', status: 404 } };
    const current = key.itemId === 101 ? { band_id: 7, release_date: '02 Oct 2026 00:00:00 GMT' } : { band_id: 7 };
    const payload = { itemType: key.itemType, itemId: key.itemId, itemUrl, tralbum: { current, trackinfo: [] }, band: null };
    return { kind: 'ok', value: { kind: 'page', document: { endpoint: 'release_page', payload, fetchedAt: at } } };
  },
  async fetchBandDetails(bandId: number): Promise<BandcampAnswer<BandDetails>> {
    tick();
    if (bandId === 2) return { kind: 'error', status: 503 };
    const bandDetails = { discography: [{ release_date: NOW / 1000 + 14 * 86400 }] };
    return { kind: 'ok', value: { kind: 'details', bandDetails, document: { endpoint: 'band_details', payload: { bandId, bandDetails }, fetchedAt: at } } };
  },
};

let gatherState: GatherState = EMPTY_GATHER_STATE;
let walkState: WalkState | null = null;
const held = new Set<string>();

const sink: GatherSink = {
  async putRaw(doc) {
    const key = `${doc.endpoint}:${JSON.stringify(doc.payload)}`;
    const deduped = held.has(key);
    held.add(key);
    console.log(`  putRaw ${doc.endpoint} deduped=${deduped}`);
    return { deduped };
  },
  async readWalk() {
    return walkState;
  },
  async writeWalk(walk) {
    walkState = walk;
    console.log(`  walk: ${walk === null ? 'null (finished)' : JSON.stringify(walk)}`);
  },
  async readGatherState() {
    return gatherState;
  },
  async patchGatherState(patch) {
    gatherState = { ...gatherState, ...patch };
  },
  async readFollowedBands() {
    return [
      { bandId: 1, name: 'Page one' },
      { bandId: 2, name: 'Page two' },
    ];
  },
  async readSweepDue() {
    return [{ bandId: 1 }, { bandId: 2 }, { bandId: 3 }];
  },
  async markSwept(bandId: number, nowMs: number, ok: boolean, booking: SweepBooking) {
    const inHours = (booking.nextDueAt - nowMs) / 3_600_000;
    console.log(`  markSwept band=${bandId} ok=${ok} tier=${booking.tier} failures=${booking.failures} next=+${inHours}h`);
  },
  async afterDocuments() {
    console.log('  afterDocuments (fold)');
  },
  async readUndatedReleases(nowMs: number, limit: number) {
    // The store's rule, in miniature: an attempt keeps a Release off the list for a day.
    return undated.filter((release) => nowMs - (attempted.get(`${release.itemType}:${release.itemId}`) ?? -Infinity) >= 86_400_000).slice(0, limit);
  },
  async markReleasePageAttempt(key: ReleaseKey, outcome: string, nowMs: number) {
    attempted.set(`${key.itemType}:${key.itemId}`, nowMs);
    console.log(`  markReleasePageAttempt ${key.itemType}:${key.itemId} ${outcome}`);
    if (outcome === 'dated') undated.splice(undated.findIndex((release) => release.itemId === key.itemId), 1);
  },
  async readReleaseDateCounts() {
    return { dated: 3 - undated.length, undated: undated.length };
  },
};

async function main(): Promise<void> {
  console.log('turn 1');
  const summary = await runGatherTurn(session, sink, { now: () => NOW, reason: 'open', budgetMs: 60_000, random: () => 0.5 });
  console.log('summary:', JSON.stringify(summary));
  console.log('gather state:', JSON.stringify(gatherState, null, 2));

  // A poll fifteen minutes on: one new Story above the stop line, then older ones already held.
  pages.splice(0, pages.length, feedPage(1790320000, 1790338000, [7, 1, 2]));
  feedCalls = 0;
  console.log('turn 2');
  const later = NOW + 15 * 60_000;
  const poll = await runGatherTurn(session, sink, { now: () => later, reason: 'timer', budgetMs: 60_000, random: () => 0.5 });
  console.log('summary:', JSON.stringify(poll));
  console.log('newestStoryDate:', gatherState.newestStoryDate, 'storiesSoFar:', gatherState.storiesSoFar);
  console.log('releasesDated:', gatherState.releasesDated, 'releasesUndated:', gatherState.releasesUndated);

  // A first walk with no end, two seconds a request and a thirty second budget, two days on: the walk stops early
  // enough for the two undated Releases left, then the release pages spend the rest.
  gatherState = { ...EMPTY_GATHER_STATE, identity: gatherState.identity };
  walkState = null;
  feedCalls = 0;
  endlessFeed = true;
  requestCostMs = 2_000;
  clock = NOW + 2 * 86_400_000;
  const started = clock;
  console.log('turn 3');
  const tight = await runGatherTurn(session, sink, { now: () => clock, reason: 'open', budgetMs: 30_000, random: () => 0.5 });
  console.log('summary:', JSON.stringify(tight), 'feed pages:', feedCalls, 'spent ms:', clock - started);
  console.log('releasesDated:', gatherState.releasesDated, 'releasesUndated:', gatherState.releasesUndated);
}

void main();

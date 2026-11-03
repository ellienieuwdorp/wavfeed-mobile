/**
 * The Demo: real Releases read once from public label pages (`releases.ts`), bought and wishlisted by
 * made-up Fans, loaded into an empty store as Raw Documents (ADR-0004). The feed pages and the following list are
 * written the way the wire writes them, with Story dates in the eight weeks before `now` and release days as Bandcamp
 * gave them; the release pages go in as they were read, after the feed, since the fold reads in insertion order. The
 * made-up Fans carry no face, and the store's Fan is `DEMO_FAN_ID`, which the gather runner, the heart, Settings and
 * the Bought by sheet each read as the Demo.
 */
import type { SQLiteDatabase } from 'expo-sqlite';

import { FEED_UPDATES_ENDPOINT, FOLLOWING_BANDS_ENDPOINT, RELEASE_PAGE_ENDPOINT } from '@/domain/endpoints';
import { readTralbumTracks } from '@/domain/tralbumTracks';
import type { ItemType } from '@/domain/types';
import { asRecord, asTralbumType, readDate, readId, readText } from '@/domain/wire';
import { EMPTY_GATHER_STATE, type GatherState } from '@/fetcher/sink';
import { DAY_MS as DAY, HOUR_MS as HOUR } from '@/lib/time';
import { GATHER_KEY } from '@/state/gatherSink';
import { fold } from '@/store/projection';
import { IDENTITY_KEY, type StoredIdentity, writeKv } from '@/store/kv';
import { insertRawDocument } from '@/store/rawDocuments';

import { DEMO_FAN_ID } from './fan';
import { demoReleases } from './releases';
import { type Rng, seeded, wireDate } from './wireShape';

const WINDOW = 56 * DAY;
const NEW_RELEASE_WINDOW = 84 * DAY;
const FEED_PAGE_SIZE = 50;

/** Invented handles, a few with a name; none is a face or a link. */
const FANS: readonly { readonly username: string; readonly name: string | null }[] = [
  { username: 'night_ferry', name: 'Noor' },
  { username: 'okra.tapes', name: null },
  { username: 'lowtide_lena', name: 'Lena' },
  { username: 'marrow_digs', name: null },
  { username: 'sunroom.sam', name: 'Sam' },
  { username: 'quiet_aki', name: null },
  { username: 'crate_ines', name: 'Ines' },
  { username: 'dub.delphine', name: null },
  { username: 'tessellate_fm', name: null },
  { username: 'fernhollow', name: 'Oskar' },
  { username: 'paper.moth', name: null },
  { username: 'velour_vic', name: 'Vic' },
];

type Fan = { readonly fanId: number; readonly username: string; readonly name: string | null };

type Release = {
  readonly itemType: ItemType;
  readonly itemId: number;
  readonly title: string;
  readonly url: string;
  readonly bandId: number;
  readonly bandName: string;
  readonly bandUrl: string;
  readonly artId: number | null;
  readonly releaseMs: number | null;
  readonly publishedMs: number | null;
  readonly preorder: boolean;
  readonly featured: { readonly id: number; readonly title: string; readonly num: number; readonly duration: number | null } | null;
  readonly streamable: number;
};

type Story = { readonly kind: 'fp' | 'fw' | 'nr'; readonly fan: Fan | null; readonly release: Release; readonly at: number };

function readRelease(payload: unknown): Release | null {
  const page = asRecord(payload);
  const tralbum = asRecord(page?.tralbum);
  const band = asRecord(page?.band);
  const current = asRecord(tralbum?.current) ?? {};
  if (page === undefined || tralbum === undefined || band === undefined) return null;
  const itemType = asTralbumType(readText(page, 'itemType'));
  const itemId = readId(page, 'itemId');
  const url = readText(page, 'itemUrl');
  const bandId = readId(band, 'id');
  const bandName = readText(band, 'name');
  const title = readText(current, 'title');
  if (itemType === undefined || itemId === undefined || url === undefined || bandId === undefined || bandName === undefined || title === undefined) {
    return null;
  }
  const tracks = readTralbumTracks(tralbum);
  const playing = tracks.filter((track) => track.streamUrl !== null);
  const first = playing[0];
  const released = readDate(current, 'release_date') ?? readDate(tralbum, 'album_release_date');
  return {
    itemType,
    itemId,
    title,
    url,
    bandId,
    bandName,
    bandUrl: new URL(url).origin,
    artId: readId(tralbum, 'art_id') ?? null,
    releaseMs: released?.getTime() ?? null,
    publishedMs: readDate(current, 'publish_date')?.getTime() ?? null,
    preorder: tralbum.is_preorder === true,
    featured: first === undefined ? null : { id: Number(first.trackId), title: first.title, num: first.trackNum, duration: first.duration },
    streamable: playing.length,
  };
}

/** From the later of the window's start and `floor` up to an hour before `now`. */
function momentAfter(rng: Rng, floor: number | null, now: number): number {
  const from = Math.max(now - WINDOW, floor ?? now - WINDOW);
  const to = now - HOUR;
  return from >= to ? to : from + Math.floor(rng() * (to - from));
}

function makeStories(rng: Rng, fans: readonly Fan[], releases: readonly Release[], now: number): Story[] {
  const stories: Story[] = [];
  const keys = new Set<string>();
  const add = (story: Story) => {
    const key = `${story.kind}:${story.fan?.fanId ?? 0}:${story.release.itemId}`;
    if (story.at >= now || keys.has(key)) return;
    keys.add(key);
    stories.push(story);
  };
  for (const release of releases) {
    // A pre-order's Story is the day its page went public; a released one's, a few hours after it came out.
    const at = release.preorder ? release.publishedMs : release.releaseMs === null ? null : release.releaseMs + (3 + Math.floor(rng() * 12)) * HOUR;
    if (at !== null && at > now - NEW_RELEASE_WINDOW) add({ kind: 'nr', fan: null, release, at });
  }
  // One Fan's evening of buying, three weeks back, so the feed shows a Burst.
  const burstFan = fans[0];
  const burstAt = now - 20 * DAY - 3 * HOUR;
  const older = releases.filter((release) => !release.preorder && (release.releaseMs ?? 0) < burstAt);
  if (burstFan !== undefined) {
    for (const [n, release] of older.slice(0, 6).entries()) add({ kind: 'fp', fan: burstFan, release, at: burstAt + n * 8 * 60_000 });
  }
  for (const [index, fan] of fans.entries()) {
    const buys = 4 + Math.floor(rng() * 8);
    const wishes = 1 + Math.floor(rng() * 4);
    for (let n = 0; n < buys + wishes; n += 1) {
      // Earlier Fans reach further into the list, so a few Releases gather several buyers.
      const release = releases[Math.floor(Math.pow(rng(), 1 + index / fans.length) * releases.length)];
      if (release === undefined) continue;
      const floor = release.preorder ? release.publishedMs : release.releaseMs;
      add({ kind: n < buys ? 'fp' : 'fw', fan, release, at: momentAfter(rng, floor, now) });
    }
  }
  // Every Release reaches the feed at least once.
  const reached = new Set(stories.map((story) => story.release.itemId));
  for (const release of releases) {
    const fan = fans[Math.floor(rng() * fans.length)];
    if (reached.has(release.itemId) || fan === undefined) continue;
    add({ kind: 'fp', fan, release, at: momentAfter(rng, release.preorder ? release.publishedMs : release.releaseMs, now) });
  }
  return stories.sort((a, b) => b.at - a.at);
}

function entryOf(story: Story, buyers: ReadonlyMap<number, number>, index: number): Record<string, unknown> {
  const { release } = story;
  const entry: Record<string, unknown> = {
    story_type: story.kind,
    story_date: wireDate(story.at),
    fan_id: story.fan?.fanId ?? DEMO_FAN_ID,
    band_id: release.bandId,
    band_name: release.bandName,
    band_url: release.bandUrl,
    item_type: release.itemType,
    item_id: release.itemId,
    item_title: release.title,
    item_url: release.url,
    album_id: release.itemType === 'a' ? release.itemId : null,
    album_title: release.itemType === 'a' ? release.title : null,
    item_art_id: release.artId,
    item_art: null,
    tags: [],
    label: null,
    label_id: null,
    price: null,
    currency: null,
    genre_id: null,
    featured_track: release.featured?.id ?? null,
    featured_track_title: release.featured?.title ?? null,
    featured_track_number: release.featured?.num ?? null,
    featured_track_duration: release.featured?.duration ?? null,
    num_streamable_tracks: release.streamable,
    also_collected_count: buyers.get(release.itemId) ?? 0,
    is_preorder: release.preorder,
    is_purchasable: true,
    is_private: false,
  };
  if (story.kind === 'nr') return { ...entry, new_date: release.preorder || release.releaseMs === null ? null : wireDate(release.releaseMs) };
  if (story.kind === 'fw') return entry;
  return { ...entry, purchased: wireDate(story.at - 30_000), sale_item_id: 918_000_000 + index, sale_item_type: release.itemType };
}

function feedPayloads(stories: readonly Story[], now: number): Record<string, unknown>[] {
  const buyers = new Map<number, number>();
  for (const story of stories) if (story.kind === 'fp') buyers.set(story.release.itemId, (buyers.get(story.release.itemId) ?? 0) + 1);
  const payloads: Record<string, unknown>[] = [];
  for (let offset = 0; offset < stories.length; offset += FEED_PAGE_SIZE) {
    const chunk = stories.slice(offset, offset + FEED_PAGE_SIZE);
    const fanInfo: Record<string, unknown> = {};
    const bandInfo: Record<string, unknown> = {};
    for (const { fan, release } of chunk) {
      if (fan !== null) {
        fanInfo[String(fan.fanId)] = { fan_id: fan.fanId, username: fan.username, name: fan.name, bio: null, location: null, image_id: null, followed: true, followed_by: [], collection_art: [] };
      }
      bandInfo[String(release.bandId)] = { band_id: release.bandId, name: release.bandName, followed: true, genre_id: null, image_id: null, latest_art_id: null, no_index: false };
    }
    payloads.push({
      ok: true,
      stories: {
        entries: chunk.map((story, n) => entryOf(story, buyers, offset + n)),
        track_list: [],
        newest_story_date: Math.floor((chunk[0]?.at ?? now) / 1000),
        oldest_story_date: Math.floor((chunk[chunk.length - 1]?.at ?? now) / 1000),
        feed_timestamp: Math.floor(now / 1000),
      },
      fan_info: fanInfo,
      band_info: bandInfo,
      item_lookup: {},
      story_collectors: {},
    });
  }
  return payloads;
}

function followingBandsPayload(releases: readonly Release[], now: number): Record<string, unknown> {
  const pages = new Map<number, Release>();
  for (const release of releases) if (!pages.has(release.bandId)) pages.set(release.bandId, release);
  const cache: Record<string, unknown> = {};
  for (const [bandId, release] of pages) {
    cache[String(bandId)] = { band_id: bandId, name: release.bandName, image_id: null, is_subscribed: false, date_followed: wireDate(now - 200 * DAY) };
  }
  return {
    fanId: DEMO_FAN_ID,
    page: 1,
    snapshotStartedAt: new Date(now).toISOString(),
    followingBands: {
      item_cache: { following_bands: cache },
      following_bands: { item_count: pages.size, last_token: `${Math.floor(now / 1000)}:1:f::`, sequence: [...pages.keys()].map(String) },
    },
  };
}

/** Loads the Demo into an empty store and folds it; the Demo Fan and a finished first walk go in kv. */
export async function loadDemo(db: SQLiteDatabase, now: number = Date.now()): Promise<void> {
  const rng = seeded(20260929);
  const fans = FANS.map((fan, index) => ({ fanId: 9_100_000 + index * 41, ...fan }));
  const releases = demoReleases.pages.map((page) => readRelease(page.payload)).filter((release) => release !== null);
  const stories = makeStories(rng, fans, releases, now);
  const gatheredAt = now - 2 * 60_000;
  const documents = [
    ...feedPayloads(stories, now).map((payload) => ({ endpoint: FEED_UPDATES_ENDPOINT, payload })),
    { endpoint: FOLLOWING_BANDS_ENDPOINT, payload: followingBandsPayload(releases, now) },
  ];
  for (const [index, doc] of documents.entries()) {
    await insertRawDocument(db, { ...doc, fetchedAt: new Date(gatheredAt - (documents.length - index) * 200).toISOString() });
  }
  for (const page of demoReleases.pages) await insertRawDocument(db, { endpoint: RELEASE_PAGE_ENDPOINT, payload: page.payload, fetchedAt: page.fetchedAt });
  await fold(db);

  const identity: StoredIdentity = { fanId: DEMO_FAN_ID, username: '', name: null, avatarUrl: null };
  await writeKv(db, IDENTITY_KEY, identity);
  const gather: GatherState = {
    ...EMPTY_GATHER_STATE,
    identity: { fanId: DEMO_FAN_ID, username: '' },
    lastTurnAt: gatheredAt,
    lastSuccessAt: gatheredAt,
    initialWalkDone: true,
    storiesSoFar: stories.length,
    newestStoryDate: Math.floor((stories[0]?.at ?? now) / 1000),
    followsFetchedAt: gatheredAt,
    wishlistFetchedAt: gatheredAt,
    wishlistAskedAt: gatheredAt,
  };
  await writeKv(db, GATHER_KEY, gather);
}

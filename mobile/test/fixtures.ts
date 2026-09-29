/**
 * Synthetic Raw Document payloads for the parsers and the store, shaped like what Bandcamp answers (same keys, same
 * date forms, same numeric types) and made up throughout: no real feed data lives in the repo. Ported from
 * server/packages/projection/test/fixtures.ts (task 0036); the sweep's two documents follow what task 0001 measured
 * on 2026-08-21 (ADR-0017).
 */
import { wireDate } from './history';

type Fields = Record<string, unknown>;

export const FAN_ID = 2214537;
export const OTHER_FAN_ID = 990211;
export const BAND_ID = 3820115;
export const ITEM_ID = 4102938475;
/** A merch item's id: the vinyl, not the Release it presses. */
const MERCH_ITEM_ID = 326012402;

/** Bandcamp's feed date form, "18 Aug 2026 07:28:27 GMT". */
const STORY_DATE = '18 Aug 2026 07:28:27 GMT';
const PURCHASE_DATE = '17 Aug 2026 21:04:11 GMT';
const NEW_DATE = '14 Aug 2026 00:00:00 GMT';

/** The fields every story type carries. */
function baseEntry(overrides: Fields): Fields {
  return {
    story_date: STORY_DATE,
    fan_id: FAN_ID,
    band_id: BAND_ID,
    band_name: 'Nightgraft',
    band_url: 'https://nightgraft.bandcamp.com',
    item_type: 'a',
    item_id: ITEM_ID,
    item_title: 'Slow Harbour',
    item_url: 'https://nightgraft.bandcamp.com/album/slow-harbour',
    album_id: ITEM_ID,
    album_title: 'Slow Harbour',
    item_art_id: 1204871,
    item_art: {
      url: 'https://f4.bcbits.com/img/a1204871_10.jpg',
      thumb_url: 'https://f4.bcbits.com/img/a1204871_3.jpg',
      art_id: 1204871,
    },
    tags: [
      { name: 'Ambient', norm_name: 'ambient', isloc: false, loc_id: 0 },
      { name: 'Rotterdam', norm_name: 'rotterdam', isloc: true, loc_id: 2747891 },
    ],
    label: 'Halfmoon Tapes',
    label_id: 771204,
    price: 7.5,
    currency: 'EUR',
    genre_id: 10,
    featured_track: 55501122,
    featured_track_title: 'Low Tide',
    featured_track_number: 2,
    featured_track_duration: 314.52,
    num_streamable_tracks: 8,
    also_collected_count: 12,
    is_preorder: false,
    is_purchasable: true,
    is_private: false,
    ...overrides,
  };
}

/** `fp`: a Fan bought a Release. */
export function fpEntry(overrides: Fields = {}): Fields {
  return baseEntry({
    story_type: 'fp',
    purchased: PURCHASE_DATE,
    sale_item_id: 908172635,
    sale_item_type: 'a',
    ...overrides,
  });
}

/**
 * `fp` with `item_type: "p"`, shaped after a real entry: the merch item owns item_id and item_title, and the Release
 * is named by tralbum_type, tralbum_id and album_title.
 */
export function pEntry(overrides: Fields = {}): Fields {
  return fpEntry({
    item_type: 'p',
    item_id: MERCH_ITEM_ID,
    tralbum_type: 'a',
    tralbum_id: ITEM_ID,
    item_title: 'Slow Harbour 12" vinyl',
    album_id: ITEM_ID,
    album_title: 'Slow Harbour',
    sale_item_type: 'p',
    merch_ids: [MERCH_ITEM_ID],
    price: 24,
    ...overrides,
  });
}

/** `fw`: a Fan wishlisted a Release. */
export function fwEntry(overrides: Fields = {}): Fields {
  return baseEntry({ story_type: 'fw', ...overrides });
}

/** `nr`: a Page published a Release. The fan_id is the feed owner's and names no actor. */
export function nrEntry(overrides: Fields = {}): Fields {
  return baseEntry({ story_type: 'nr', new_date: NEW_DATE, ...overrides });
}

/** A purchase Story of album `itemId` at `at` (unix seconds), for tests that page through many of them. */
export function purchaseAt(itemId: number, at: number): Fields {
  const date = wireDate(at * 1000);
  return fpEntry({
    story_date: date,
    purchased: date,
    item_id: itemId,
    item_title: `Release ${itemId}`,
    item_url: `https://nightgraft.bandcamp.com/album/r${itemId}`,
    album_id: itemId,
    album_title: `Release ${itemId}`,
  });
}

/** One `fan_info` record, keyed by String(fan_id) in the payload. */
export function fanInfo(overrides: Fields = {}): Fields {
  return {
    fan_id: FAN_ID,
    username: 'diggerfan',
    name: 'Digger',
    bio: 'crates, mostly',
    location: 'Rotterdam, Netherlands',
    image_id: 88123456,
    followed: true,
    followed_by: [],
    collection_art: [],
    ...overrides,
  };
}

/** One `band_info` record, keyed by String(band_id) in the payload. */
function bandInfo(overrides: Fields = {}): Fields {
  return {
    band_id: BAND_ID,
    name: 'Nightgraft Recordings',
    followed: true,
    genre_id: 10,
    image_id: 40118822,
    latest_art_id: 1204871,
    no_index: false,
    ...overrides,
  };
}

type FeedPayloadParts = {
  /** `unknown`, so a test can hand the parser something that is not an entry. */
  readonly entries: readonly unknown[];
  readonly fanInfo?: Record<string, unknown>;
  readonly bandInfo?: Record<string, unknown>;
};

/** A whole `fan_dash_feed_updates` payload, with the envelope fields the real endpoint returns. */
export function feedPayload(parts: FeedPayloadParts): Record<string, unknown> {
  return {
    ok: true,
    stories: {
      entries: parts.entries,
      track_list: [],
      newest_story_date: 1787045307,
      oldest_story_date: 1786958907,
      feed_timestamp: 1787045400,
    },
    fan_info: parts.fanInfo ?? { [String(FAN_ID)]: fanInfo() },
    band_info: parts.bandInfo ?? { [String(BAND_ID)]: bandInfo() },
    item_lookup: {},
    story_collectors: {},
  };
}

/** What a release page says a record came out, in the feed's date form. */
const PAGE_RELEASE_DATE = '05 Aug 2026 00:00:00 GMT';
const ITEM_URL = 'https://nightgraft.bandcamp.com/album/slow-harbour';

/** A signed preview URL's shape; the host and signature are made up. */
function streamUrl(trackId: number): string {
  return `https://t4.bcbits.com/stream/0f1e2d3c4b5a/mp3-128/${trackId}?p=0&ts=1790000000&t=9a8b7c6d`;
}

/**
 * An album page's `data-tralbum` blob, cut to the keys the parser reads and some of their neighbours, shaped after
 * real pages fetched on 2026-08-21. Two of its three tracks stream.
 */
export function tralbumBlob(overrides: Fields = {}): Fields {
  return {
    current: {
      title: 'Slow Harbour',
      new_date: '31 Mar 2026 19:31:36 GMT',
      publish_date: '31 Mar 2026 19:43:06 GMT',
      mod_date: '31 Mar 2026 19:43:06 GMT',
      band_id: BAND_ID,
      release_date: PAGE_RELEASE_DATE,
      album_id: ITEM_ID,
      id: ITEM_ID,
      type: 'album',
    },
    art_id: 1204871,
    artist: 'Nightgraft',
    item_type: 'album',
    id: ITEM_ID,
    is_preorder: false,
    album_release_date: PAGE_RELEASE_DATE,
    trackinfo: [
      { id: 55501122, title: 'Low Tide', duration: 314.52, streaming: 1, file: { 'mp3-128': streamUrl(55501122) } },
      { id: 55501123, title: 'Slow Harbour', duration: 402.1, streaming: 1, file: { 'mp3-128': streamUrl(55501123) } },
      { id: 55501124, title: 'Silt', duration: 288.4, streaming: null, file: null },
    ],
    url: ITEM_URL,
    ...overrides,
  };
}

/** An Upcoming album's release day, and the moment its page went public with one of its four Tracks out. */
export const PREORDER_RELEASE_DATE = '13 Oct 2026 00:00:00 GMT';
export const PREORDER_PUBLISHED = '29 Sep 2026 09:12:40 GMT';
export const PREORDER_ITEM_ID = 4102939111;
export const PREORDER_URL = 'https://nightgraft.bandcamp.com/album/moth-season';

/**
 * The `nr` entry of that pre-order as the feed writes it: dated when its page went public, `new_date` null, and
 * `num_streamable_tracks` the true count of Tracks that play (task 0041).
 */
export function preorderNrEntry(overrides: Fields = {}): Fields {
  return nrEntry({
    story_date: PREORDER_PUBLISHED,
    new_date: null,
    item_id: PREORDER_ITEM_ID,
    item_title: 'Moth Season',
    item_url: PREORDER_URL,
    album_id: PREORDER_ITEM_ID,
    album_title: 'Moth Season',
    item_art_id: 1204872,
    featured_track: 66602202,
    featured_track_title: 'Lamp Glass',
    featured_track_number: 2,
    featured_track_duration: 251.04,
    num_streamable_tracks: 1,
    is_preorder: true,
    ...overrides,
  });
}

/** The pre-order's four Tracks: id, title and Track page path. */
const PREORDER_TRACKS: readonly (readonly [number, string, string])[] = [
  [66602201, 'Pupa', '/track/pupa'],
  [66602202, 'Lamp Glass', '/track/lamp-glass'],
  [66602203, 'Wing Dust', '/track/wing-dust'],
  [66602204, 'Moth Season', '/track/moth-season'],
];

/** A pre-order Track's id by its number, 1 to 4. */
export function preorderTrackId(trackNum: number): number {
  return PREORDER_TRACKS[trackNum - 1]?.[0] ?? 0;
}

/**
 * A Track of the pre-order as the album page writes it. One not out yet has no id, no link, no file, and still
 * `streaming: 1`; one out has all three.
 */
function preorderTrack(trackNum: number, out: boolean): Fields {
  const [trackId, title, path] = PREORDER_TRACKS[trackNum - 1] ?? [0, '', ''];
  const shared = { track_id: trackId, track_num: trackNum, title, streaming: 1, is_capped: null };
  if (!out) return { ...shared, id: null, title_link: null, file: null, unreleased_track: true, duration: 0 };
  return { ...shared, id: trackId, title_link: path, file: { 'mp3-128': streamUrl(trackId) }, unreleased_track: false, duration: 251.04 };
}

/**
 * A pre-order album's `data-tralbum` blob shaped after a real page read on 2026-09-29 (task 0041): out on 13 October,
 * its second Track let out early, the other three named but not out. `out` names the Tracks that play instead.
 */
export function preorderTralbumBlob(overrides: Fields = {}, out: readonly number[] = [2]): Fields {
  return {
    current: {
      title: 'Moth Season',
      publish_date: PREORDER_PUBLISHED,
      mod_date: PREORDER_PUBLISHED,
      band_id: BAND_ID,
      release_date: PREORDER_RELEASE_DATE,
      album_id: PREORDER_ITEM_ID,
      id: PREORDER_ITEM_ID,
      type: 'album',
    },
    art_id: 1204872,
    artist: 'Nightgraft',
    item_type: 'album',
    id: PREORDER_ITEM_ID,
    is_preorder: true,
    album_release_date: PREORDER_RELEASE_DATE,
    trackinfo: [1, 2, 3, 4].map((trackNum) => preorderTrack(trackNum, out.includes(trackNum))),
    url: PREORDER_URL,
    ...overrides,
  };
}

/**
 * The same pre-order as the page a phone is served writes it (read 2026-09-29 with the app's User-Agent): `current`
 * has no `release_date` and no `mod_date`, and a Track not out has no `id`, `track_id`, `title_link` or `file` key.
 */
export function phonePreorderTralbumBlob(out: readonly number[] = [2]): Fields {
  return {
    current: { title: 'Moth Season', publish_date: PREORDER_PUBLISHED, band_id: BAND_ID, id: PREORDER_ITEM_ID, type: 'album' },
    art_id: 1204872,
    item_type: 'album',
    id: PREORDER_ITEM_ID,
    is_preorder: true,
    album_is_preorder: true,
    album_release_date: PREORDER_RELEASE_DATE,
    trackinfo: [1, 2, 3, 4].map((trackNum) => {
      const [trackId, title, path] = PREORDER_TRACKS[trackNum - 1] ?? [0, '', ''];
      const shared = { track_num: trackNum, title, streaming: 1, is_draft: false, has_info: false };
      if (!out.includes(trackNum)) return { ...shared, duration: 0, unreleased_track: true };
      return { ...shared, id: trackId, title_link: path, file: { 'mp3-128': streamUrl(trackId) }, unreleased_track: false, duration: 251.04 };
    }),
    url: PREORDER_URL,
  };
}

/**
 * A Track page's `data-tralbum` blob for one of the pre-order's Tracks, shaped after real Track pages read on 2026-09-29:
 * `publish_date` is the album's, `mod_date` is when the Track page last changed, `is_preorder` is null and the album's
 * state is in `album_is_preorder`.
 */
export function preorderTrackPageBlob(trackNum: number, modDate: string): Fields {
  const trackId = preorderTrackId(trackNum);
  return {
    current: { title: PREORDER_TRACKS[trackNum - 1]?.[1], publish_date: PREORDER_PUBLISHED, mod_date: modDate, band_id: BAND_ID, album_id: PREORDER_ITEM_ID, id: trackId, type: 'track' },
    item_type: 'track',
    id: trackId,
    is_preorder: null,
    album_is_preorder: true,
    album_release_date: PREORDER_RELEASE_DATE,
    trackinfo: [preorderTrack(trackNum, true)],
    url: `https://nightgraft.bandcamp.com${PREORDER_TRACKS[trackNum - 1]?.[2] ?? ''}`,
  };
}

/** The `data-band` blob: the Release's Page, kept verbatim beside the tralbum. */
export function bandBlob(overrides: Fields = {}): Fields {
  return {
    id: BAND_ID,
    name: 'Nightgraft Recordings',
    fan_email: null,
    account_id: 836639820,
    image_id: 40118822,
    ...overrides,
  };
}

/** A whole `release_page` payload as the enrichment walk stores it: the Release key it fetched for, the URL, both blobs. */
export function releasePagePayload(
  parts: { itemType?: string; itemId?: number; itemUrl?: string; tralbum?: unknown; band?: unknown } = {},
): Record<string, unknown> {
  return {
    itemType: parts.itemType ?? 'a',
    itemId: parts.itemId ?? ITEM_ID,
    itemUrl: parts.itemUrl ?? ITEM_URL,
    tralbum: parts.tralbum === undefined ? tralbumBlob() : parts.tralbum,
    band: parts.band === undefined ? bandBlob() : parts.band,
  };
}

/** A record still ahead of today: an Upcoming Release (task 0001). */
const UPCOMING_DATE = '14 Sep 2026 00:00:00 GMT';
export const UPCOMING_ITEM_ID = 4102938999;
export const UPCOMING_URL = 'https://nightgraft.bandcamp.com/album/vortex-archives';

/** One discography item, as `band_details` writes one. */
export function discographyItem(overrides: Fields = {}): Fields {
  return {
    band_id: BAND_ID,
    band_name: 'Nightgraft Recordings',
    item_id: UPCOMING_ITEM_ID,
    item_type: 'album',
    title: 'Vortex Archives',
    item_url: UPCOMING_URL,
    art_id: 1204871,
    release_date: UPCOMING_DATE,
    is_preorder: true,
    ...overrides,
  };
}

/** A whole `band_details` payload, in the envelope the sweep stores. */
export function bandDetailsPayload(
  parts: { bandId?: number; items?: readonly unknown[]; details?: Fields } = {},
): Record<string, unknown> {
  const bandId = parts.bandId ?? BAND_ID;
  return {
    bandId,
    bandDetails: {
      id: bandId,
      name: 'Nightgraft Recordings',
      bandcamp_url: 'https://nightgraft.bandcamp.com',
      image_id: 40118822,
      genre_id: 10,
      discography: parts.items ?? [discographyItem()],
      ...parts.details,
    },
  };
}

/** The walk's own start, which every page of one walk carries and a sweep is measured against (ADR-0017). */
export const FOLLOW_SNAPSHOT_AT = '2026-08-28T09:00:00.000Z';

/** The first page of a follow-list walk: the fan page's blob, cut to its two keys, with the batch keyed by band id. */
export function followingBandsFirstPage(
  bandIds: readonly number[] = [BAND_ID],
  snapshotStartedAt: string = FOLLOW_SNAPSHOT_AT,
): Record<string, unknown> {
  const cache: Record<string, unknown> = {};
  for (const bandId of bandIds) {
    cache[String(bandId)] = {
      band_id: bandId,
      name: `Band ${bandId}`,
      image_id: 40118822,
      is_subscribed: false,
      date_followed: '18 Aug 2026 07:28:27 GMT',
    };
  }
  return {
    fanId: FAN_ID,
    page: 1,
    snapshotStartedAt,
    followingBands: {
      item_cache: { following_bands: cache },
      following_bands: { item_count: bandIds.length, last_token: '1787045307:1:f::', sequence: bandIds.map(String) },
    },
  };
}

/** A continuation page: the API's own answer, an `items` array, stored as it came. */
export function followingBandsPage(
  bandIds: readonly number[],
  page = 2,
  snapshotStartedAt: string = FOLLOW_SNAPSHOT_AT,
): Record<string, unknown> {
  return {
    fanId: FAN_ID,
    page,
    snapshotStartedAt,
    followingBands: {
      items: bandIds.map((bandId) => ({ band_id: bandId, name: `Band ${bandId}`, image_id: 40118822 })),
      more_available: false,
      last_token: '1787045300:1:f::',
    },
  };
}

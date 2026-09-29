/**
 * A full store of made-up data for the simulator rig (task 0036): about 1,500 Stories over the twelve weeks before a
 * fixed Thu 24 Sep 2026, 40 Fans, 60 Pages and 300 Releases from a seeded generator, shaped like the wire as
 * server/packages/projection/test/fixtures.ts records it and entering as Raw Documents through insertRawDocument before
 * the fold reads them (ADR-0004). Every host ends in `.local`, which isFetchableTarget refuses, and no art or avatar id
 * is set, so nothing drawn from the sample reaches Bandcamp. Payloads carry no real clock, so a second run dedupes.
 * The generated pre-orders have no Track out; two more Upcoming Releases let Tracks out early, read at fixed moments
 * so their Drops land on the same days every run (task 0041), and a Fan buys one so Bought's shelf shows a count. The
 * rig loads the sample into an empty store only: a simulator that holds an older sample keeps it until Expo Go is
 * uninstalled from it (`xcrun simctl uninstall <udid> host.exp.Exponent`), which the next `dev/sim.sh serve` reinstalls.
 */
import type { SQLiteDatabase } from 'expo-sqlite';

import type { RowRelease } from '@/components/playable';
import {
  BAND_DETAILS_ENDPOINT,
  FEED_UPDATES_ENDPOINT,
  FOLLOWING_BANDS_ENDPOINT,
  RELEASE_PAGE_ENDPOINT,
  WISHLIST_ITEMS_ENDPOINT,
} from '@/domain/endpoints';
import type { ItemType } from '@/domain/types';
import { EMPTY_GATHER_STATE, type GatherState } from '@/fetcher/sink';
import { CONNECT_SHOWN_KEY, DEVICE_ADDED_KEY, GATHER_KEY } from '@/state/gatherSink';
import { fold, IDENTITY_KEY, insertRawDocument, readKv, type StoredIdentity, writeKv } from '@/store';

const DAY = 24 * 60 * 60_000;
const ANCHOR = Date.UTC(2026, 8, 24, 18, 0, 0);
const WINDOW = 84 * DAY;
const STORY_TARGET = 1500;
const FEED_PAGE_SIZE = 50;
export const SAMPLE_FAN_ID = 9_000_001;

type Rng = () => number;

function seeded(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function int(rng: Rng, lo: number, hi: number): number {
  return lo + Math.floor(rng() * (hi - lo + 1));
}

function pick<T>(rng: Rng, list: readonly T[]): T {
  const value = list[Math.floor(rng() * list.length)];
  if (value === undefined) throw new Error('pick from an empty list');
  return value;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

function two(n: number): string {
  return String(n).padStart(2, '0');
}

/** Bandcamp's own format, "18 Aug 2026 07:28:27 GMT". */
function wire(ms: number): string {
  const d = new Date(ms);
  const time = `${two(d.getUTCHours())}:${two(d.getUTCMinutes())}:${two(d.getUTCSeconds())}`;
  return `${two(d.getUTCDate())} ${MONTHS[d.getUTCMonth()] ?? 'Jan'} ${d.getUTCFullYear()} ${time} GMT`;
}

function slugOf(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

const FAN_HANDLES = [
  'dj_okonkwo', 'kessler_digs', 'mara.dj', 'nightbus_tapes', 'ruthless.ear', 'felix_vondel', 'soft_arcade', 'tamsin.w',
  'hollowcrate', 'dubplate_dora', 'ines_on_wax', 'moss_and_static', 'lowend_lars', 'petra.k', 'reel_riot', 'quietcorner',
  'basil_hertz', 'junokid', 'saltmarsh_sam', 'ode.to.tape', 'grain_collector', 'yuki_loops', 'amberline', 'crate_theory',
  'the.slow.dance', 'nour_selects', 'tidalcrate', 'mono_marta', 'digitaldune', 'kofi_plays', 'velvetcassette',
  'ash_listens', 'nils.b', 'rainroom', 'orbit_olu', 'frieda_fm', 'deepcut_dev', 'lina.sounds', 'hexa_hana', 'maybe_mateo',
] as const;

const FAN_NAMES: Readonly<Record<string, string>> = {
  dj_okonkwo: 'Chidi Okonkwo',
  kessler_digs: 'Jonas Kessler',
  'mara.dj': 'Mara',
  'tamsin.w': 'Tamsin Wray',
  felix_vondel: 'Felix van den Vondel',
  'petra.k': 'Petra',
  nour_selects: 'Nour',
  'nils.b': 'Nils Brandt',
};

const LOCATIONS = ['Rotterdam, Netherlands', 'Lagos, Nigeria', 'Berlin, Germany', 'Glasgow, UK', 'Osaka, Japan', 'Lisbon, Portugal', 'Montreal, Canada'];

const PAGE_FIRST = ['Halcyon', 'Meridian', 'Glass', 'Velvet', 'Northern', 'Paper', 'Hollow', 'Amber', 'Slow', 'Neon', 'Salt', 'Quiet', 'Copper', 'Lunar', 'Static', 'Tidal', 'Ember', 'Cobalt', 'Fern', 'Marrow'];
const PAGE_SECOND = ['Harbour', 'Tapes', 'Collective', 'Sound System', 'Orchestra', 'Ensemble', 'Frequencies', 'Choir', 'Signal', 'Garden', 'Motel', 'Radio', 'Machines', 'Archive', 'Fields'];
const TITLE_WORDS = ['Slow', 'Harbour', 'Lights', 'Dub', 'Paper', 'Moons', 'Silt', 'Low', 'Tide', 'Night', 'Swim', 'Glass', 'Rooms', 'Winter', 'Static', 'Orchard', 'Signals', 'Afterglow', 'Driftwood', 'Sodium', 'Vapour', 'Echo', 'Chamber', 'Coastal', 'Drive', 'Ferns', 'Second', 'Sun', 'Lantern', 'Weather', 'Motion', 'Blue', 'Hour', 'Distant', 'Shore', 'Dust', 'Arcade', 'Rain', 'Mirror', 'Garden'];
const LABELS = ['Halfmoon Tapes', 'Soft Error Records', 'Lowland Press', 'Cassette Weather', 'Northbound Audio'];
const TAGS = ['ambient', 'dub', 'house', 'techno', 'jazz', 'folk', 'electronic', 'experimental', 'drone', 'soul'];
const REVIEWS = [
  'The second side is the one: patient, warm, and it keeps opening up.',
  'Bought it for the title track and stayed for everything after it.',
  'Sounds like a harbour at night. On repeat all week.',
  'A tape I did not know I needed. The bass on track three is unreal.',
  'Gentle and strange in the best way. Headphones essential.',
  'Every record from this label lands, and this might be the best yet.',
  'Played it at the end of a set and three people asked what it was.',
  'Short, sharp and completely its own thing.',
  'Took a few listens. Now it is the only thing I put on in the morning.',
  'Lovely mastering, huge space in the mix.',
];

type Fan = { readonly fanId: number; readonly username: string; readonly name: string | null; readonly location: string | null };
type Page = { readonly bandId: number; readonly name: string; readonly url: string; readonly genreId: number; readonly followed: boolean; readonly currency: string };
type Track = { readonly id: number; readonly title: string; readonly duration: number; readonly playable: boolean; readonly capped: boolean };
type Release = {
  readonly itemType: ItemType;
  readonly itemId: number;
  readonly page: Page;
  readonly title: string;
  readonly url: string;
  readonly releaseMs: number;
  readonly preorder: boolean;
  readonly label: string | null;
  readonly price: number;
  readonly tags: readonly string[];
  readonly tracks: readonly Track[];
  /** The Tracks a pre-order's feed entry counts as playing: none for a generated one, a Drop demo's last read. */
  readonly outEarly: number;
  readonly weight: number;
};
type StoryKind = 'fp' | 'fw' | 'nr';
type Story = { readonly kind: StoryKind; readonly fan: Fan | null; readonly release: Release; readonly at: number; readonly why: string | null; readonly merch: boolean };

type World = { readonly fans: readonly Fan[]; readonly pages: readonly Page[]; readonly releases: readonly Release[]; readonly stories: readonly Story[] };

function makeFans(rng: Rng): Fan[] {
  return FAN_HANDLES.map((username, index) => ({
    fanId: 5_100_000 + index * 37,
    username,
    name: FAN_NAMES[username] ?? null,
    location: rng() < 0.6 ? pick(rng, LOCATIONS) : null,
  }));
}

function makePages(rng: Rng): Page[] {
  const names = new Set<string>();
  while (names.size < 60) names.add(`${pick(rng, PAGE_FIRST)} ${pick(rng, PAGE_SECOND)}`);
  return [...names].map((name, index) => ({
    bandId: 3_820_000 + index * 11,
    name,
    url: `https://${slugOf(name).replace(/-/g, '')}.bandcamp.local`,
    genreId: int(rng, 1, 26),
    followed: index < 30,
    currency: pick(rng, ['EUR', 'GBP', 'USD']),
  }));
}

function makeTitle(rng: Rng, taken: Set<string>): string {
  for (;;) {
    const words = int(rng, 1, 3);
    const title = Array.from({ length: words }, () => pick(rng, TITLE_WORDS)).join(' ');
    if (!taken.has(title) && new Set(title.split(' ')).size === words) {
      taken.add(title);
      return title;
    }
  }
}

function makeTracks(rng: Rng, itemType: ItemType, title: string, index: number): Track[] {
  const count = itemType === 't' ? 1 : int(rng, 5, 9);
  const words = new Set<string>();
  return Array.from({ length: count }, (_, n) => ({
    id: 55_000_000 + index * 20 + n,
    title: itemType === 't' ? title : makeTitle(rng, words),
    duration: int(rng, 1200, 4800) / 10,
    playable: !(index % 5 === 0 && n >= count - 2) && rng() > 0.08,
    capped: (index % 7 === 0 && n === 1) || rng() < 0.05,
  }));
}

const FUTURE_DAYS = [2, 5, 9, 16, 23, 37];

function makeReleases(rng: Rng, pages: readonly Page[]): Release[] {
  const titles = new Set<string>();
  const releases: Release[] = [];
  for (let index = 0; index < 300; index += 1) {
    const page = pages[Math.floor(index / 5)];
    if (page === undefined) throw new Error('a Release with no Page');
    const itemType: ItemType = rng() < 0.1 ? 't' : 'a';
    const itemId = 4_100_000_000 + index * 13;
    const title = makeTitle(rng, titles);
    const futureDays = index % 5 === 4 && index < 30 ? FUTURE_DAYS[Math.floor(index / 5)] : undefined;
    const day = Math.floor(ANCHOR / DAY) * DAY;
    releases.push({
      itemType,
      itemId,
      page,
      title,
      url: `${page.url}/${itemType === 'a' ? 'album' : 'track'}/${slugOf(title)}`,
      releaseMs: futureDays !== undefined ? day + futureDays * DAY : day - int(rng, 1, 112) * DAY,
      preorder: futureDays !== undefined,
      label: rng() < 0.5 ? pick(rng, LABELS) : null,
      price: pick(rng, [1, 5, 7, 7.5, 8, 10, 12]),
      tags: [pick(rng, TAGS), pick(rng, TAGS)].filter((tag, n, all) => all.indexOf(tag) === n),
      tracks: makeTracks(rng, itemType, title, index),
      outEarly: 0,
      weight: 1 / Math.pow(1 + Math.floor(rng() * 300), 0.85),
    });
  }
  return releases;
}

function weightedPicker<T extends { readonly weight: number }>(rng: Rng, items: readonly T[]): () => T {
  const sums: number[] = [];
  let total = 0;
  for (const item of items) sums.push((total += item.weight));
  return () => {
    const target = rng() * total;
    let lo = 0;
    let hi = sums.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if ((sums[mid] ?? 0) < target) lo = mid + 1;
      else hi = mid;
    }
    const item = items[lo];
    if (item === undefined) throw new Error('weighted pick out of range');
    return item;
  };
}

function makeStories(rng: Rng, fans: readonly Fan[], releases: readonly Release[]): Story[] {
  const stories: Story[] = [];
  const keys = new Set<string>();
  const add = (story: Story): boolean => {
    const key = `${story.kind}:${story.fan?.fanId ?? 0}:${story.release.itemId}`;
    if (keys.has(key)) return false;
    keys.add(key);
    stories.push(story);
    return true;
  };
  const start = ANCHOR - WINDOW;
  for (const release of releases) {
    if (!release.page.followed) continue;
    if (release.preorder && release.releaseMs - ANCHOR > 10 * DAY) continue;
    const at = release.preorder ? ANCHOR - int(rng, 1, 10) * DAY : release.releaseMs + int(rng, 1, 20) * 3_600_000;
    if (at >= start && at < ANCHOR) add({ kind: 'nr', fan: null, release, at, why: null, merch: false });
  }

  const kessler = fans[1];
  const albums = releases.filter((release) => !release.preorder && release.releaseMs < ANCHOR - 22 * DAY);
  if (kessler !== undefined) {
    const burstAt = ANCHOR - 21 * DAY + 19 * 3_600_000;
    for (let n = 0; n < 7; n += 1) add({ kind: 'fp', fan: kessler, release: pick(rng, albums), at: burstAt + n * 300_000, why: null, merch: false });
  }

  const fanPick = weightedPicker(rng, fans.map((fan, index) => ({ fan, weight: 1 / Math.pow(index + 1, 0.4) })));
  const releasePick = weightedPicker(rng, releases);
  const purchases = Math.round((STORY_TARGET - stories.length) * 0.7);
  let reviews = 0;
  let merch = 0;
  const fill = (kind: 'fp' | 'fw', until: number): void => {
    for (let tries = 0; stories.length < until && tries < 50_000; tries += 1) {
      const release = releasePick();
      if (release.preorder && release.releaseMs - ANCHOR > 12 * DAY) continue;
      const floor = release.preorder ? ANCHOR - 10 * DAY : Math.max(start, release.releaseMs);
      const at = floor + Math.floor(rng() * (ANCHOR - floor));
      const why = kind === 'fp' && reviews < REVIEWS.length && rng() < 0.02 ? (REVIEWS[reviews] ?? null) : null;
      const isMerch = kind === 'fp' && why === null && merch < 4 && release.itemType === 'a' && rng() < 0.01;
      if (add({ kind, fan: fanPick().fan, release, at, why, merch: isMerch })) {
        if (why !== null) reviews += 1;
        if (isMerch) merch += 1;
      }
    }
  };
  for (const release of releases) {
    if (release.page.followed || release.preorder) continue;
    const at = Math.max(start, release.releaseMs) + Math.floor(rng() * (ANCHOR - Math.max(start, release.releaseMs)));
    add({ kind: rng() < 0.6 ? 'fp' : 'fw', fan: fanPick().fan, release, at, why: null, merch: false });
  }
  fill('fp', stories.length + purchases);
  fill('fw', STORY_TARGET);
  return stories.sort((a, b) => b.at - a.at);
}

/**
 * The Upcoming Releases that let Tracks out early (task 0041), each on a followed Page with no Story, so the Sweep dates
 * it and its release page reads write its Drops. Every read is a moment fixed against ANCHOR, never the clock, and
 * `reads` lists the Tracks playing on each read in order, `trackPage` a Track page whose `mod_date` dates the later
 * Drop, `purchase` a Fan's purchase Story after the last read that puts the Release on Bought's shelf.
 */
type DropDemo = {
  readonly release: Release;
  readonly publishedMs: number;
  readonly reads: readonly { readonly atMs: number; readonly out: readonly number[] }[];
  readonly trackPage?: { readonly atMs: number; readonly trackNum: number; readonly modMs: number };
  readonly purchase?: { readonly fanIndex: number; readonly atMs: number };
};

const HOUR = 60 * 60_000;

function dropTracks(first: number, titles: readonly string[]): Track[] {
  return titles.map((title, n) => ({ id: first + n, title, duration: 200 + n * 37.5, playable: true, capped: false }));
}

function dropDemos(pages: readonly Page[]): DropDemo[] {
  const day = Math.floor(ANCHOR / DAY) * DAY;
  const release = (n: number, page: Page | undefined, title: string, releaseDays: number, tracks: Track[], outEarly: number): Release => {
    if (page === undefined) throw new Error('a Release with no Page');
    return {
      itemType: 'a',
      itemId: 4_100_000_000 + (300 + n) * 13,
      page,
      title,
      url: `${page.url}/album/${slugOf(title)}`,
      releaseMs: day + releaseDays * DAY,
      preorder: true,
      label: LABELS[n] ?? null,
      price: 8,
      tags: ['ambient'],
      tracks,
      outEarly,
      weight: 0,
    };
  };
  const moths = dropTracks(56_000_001, ['Pupal', 'Lamp Glass', 'Wing Dust', 'Moth Lanterns']);
  const signals = dropTracks(56_000_011, ['Sounding', 'Low Band', 'Carrier', 'Shortwave', 'Night Net', 'Weathered Signals']);
  return [
    // Out Tue 13 Oct; its second Track came out with the page on Mon 21 Sep: 1 of 4, one Drop.
    {
      release: release(0, pages[3], 'Moth Lanterns', 19, moths, 1),
      publishedMs: day - 3 * DAY + 9 * HOUR,
      reads: [{ atMs: day - 2 * DAY + 7 * HOUR, out: [2] }],
    },
    // Out Sat 24 Oct; two Tracks with the page on Mon 14 Sep, a third on Tue 22 Sep by its Track page: 3 of 6, two Drops.
    // Bought on Wed 23 Sep, after the read that showed the third.
    {
      release: release(1, pages[8], 'Weathered Signals', 30, signals, 3),
      publishedMs: day - 10 * DAY + 10 * HOUR + 30 * 60_000,
      reads: [
        { atMs: day - 9 * DAY + 8 * HOUR, out: [1, 2] },
        { atMs: day - DAY + 8 * HOUR, out: [1, 2, 3] },
      ],
      trackPage: { atMs: day - DAY + 8 * HOUR + 60_000, trackNum: 3, modMs: day - 2 * DAY + 20 * HOUR + 36 * 60_000 },
      purchase: { fanIndex: 0, atMs: day - DAY + 14 * HOUR },
    },
  ];
}

function makeWorld(): World {
  const rng = seeded(20260924);
  const fans = makeFans(rng);
  const pages = makePages(rng);
  const releases = makeReleases(rng, pages);
  const stories = makeStories(rng, fans, releases);
  // Added after the seeded draws, so the rest of the world is what it always was.
  const demos = dropDemos(pages);
  const bought = demos.flatMap(({ release, purchase }): Story[] => {
    const fan = purchase === undefined ? undefined : fans[purchase.fanIndex];
    return purchase === undefined || fan === undefined ? [] : [{ kind: 'fp', fan, release, at: purchase.atMs, why: null, merch: false }];
  });
  return {
    fans,
    pages,
    releases: [...releases, ...demos.map((demo) => demo.release)],
    stories: [...stories, ...bought].sort((a, b) => b.at - a.at),
  };
}

function featured(release: Release): Track | undefined {
  return release.tracks.find((track) => track.playable) ?? release.tracks[0];
}

function entryOf(story: Story, buyers: ReadonlyMap<number, number>, index: number): Record<string, unknown> {
  const { release } = story;
  const { page } = release;
  const track = featured(release);
  const entry: Record<string, unknown> = {
    story_type: story.kind,
    story_date: wire(story.at),
    fan_id: story.fan?.fanId ?? SAMPLE_FAN_ID,
    band_id: page.bandId,
    band_name: page.name,
    band_url: page.url,
    item_type: release.itemType,
    item_id: release.itemId,
    item_title: release.title,
    item_url: release.url,
    album_id: release.itemType === 'a' ? release.itemId : null,
    album_title: release.itemType === 'a' ? release.title : null,
    item_art_id: null,
    item_art: null,
    tags: release.tags.map((tag) => ({ name: tag, norm_name: tag, isloc: false, loc_id: 0 })),
    label: release.label,
    label_id: release.label === null ? null : 771_200 + LABELS.indexOf(release.label),
    price: release.price,
    currency: page.currency,
    genre_id: page.genreId,
    featured_track: track?.id ?? null,
    featured_track_title: track?.title ?? null,
    featured_track_number: track === undefined ? null : release.tracks.indexOf(track) + 1,
    featured_track_duration: track?.duration ?? null,
    // A pre-order counts only the Tracks it let out early (task 0041).
    num_streamable_tracks: release.preorder ? release.outEarly : release.tracks.filter((t) => t.playable).length,
    also_collected_count: buyers.get(release.itemId) ?? 0,
    is_preorder: release.preorder,
    is_purchasable: true,
    is_private: false,
  };
  if (story.kind === 'nr') return { ...entry, new_date: wire(release.releaseMs) };
  if (story.kind === 'fw') return entry;
  const purchase = { ...entry, purchased: wire(story.at - 30_000), sale_item_id: 908_000_000 + index, sale_item_type: release.itemType };
  const reviewed = story.why === null ? purchase : { ...purchase, why: story.why };
  if (!story.merch) return reviewed;
  const merchId = 326_000_000 + index;
  return {
    ...reviewed,
    item_type: 'p',
    item_id: merchId,
    tralbum_type: release.itemType,
    tralbum_id: release.itemId,
    item_title: `${release.title} 12" vinyl`,
    sale_item_type: 'p',
    merch_ids: [merchId],
    price: 24,
  };
}

function feedPayloads(world: World): Record<string, unknown>[] {
  const buyers = new Map<number, number>();
  for (const story of world.stories) if (story.kind === 'fp') buyers.set(story.release.itemId, (buyers.get(story.release.itemId) ?? 0) + 1);
  const payloads: Record<string, unknown>[] = [];
  for (let offset = 0; offset < world.stories.length; offset += FEED_PAGE_SIZE) {
    const chunk = world.stories.slice(offset, offset + FEED_PAGE_SIZE);
    const fanInfo: Record<string, unknown> = {};
    const bandInfo: Record<string, unknown> = {};
    for (const { fan, release } of chunk) {
      if (fan !== null) {
        fanInfo[String(fan.fanId)] = { fan_id: fan.fanId, username: fan.username, name: fan.name, bio: null, location: fan.location, image_id: null, followed: true, followed_by: [], collection_art: [] };
      }
      const { page } = release;
      bandInfo[String(page.bandId)] = { band_id: page.bandId, name: page.name, followed: page.followed, genre_id: page.genreId, image_id: null, latest_art_id: null, no_index: false };
    }
    const newest = chunk[0]?.at ?? ANCHOR;
    const oldest = chunk[chunk.length - 1]?.at ?? ANCHOR;
    payloads.push({
      ok: true,
      stories: {
        entries: chunk.map((story, n) => entryOf(story, buyers, offset + n)),
        track_list: [],
        newest_story_date: Math.floor(newest / 1000),
        oldest_story_date: Math.floor(oldest / 1000),
        feed_timestamp: Math.floor(ANCHOR / 1000),
      },
      fan_info: fanInfo,
      band_info: bandInfo,
      item_lookup: {},
      story_collectors: {},
    });
  }
  return payloads;
}

function followingBandsPayload(world: World): Record<string, unknown> {
  const followed = world.pages.filter((page) => page.followed);
  const cache: Record<string, unknown> = {};
  for (const page of followed) {
    cache[String(page.bandId)] = { band_id: page.bandId, name: page.name, image_id: null, is_subscribed: false, date_followed: wire(ANCHOR - 200 * DAY) };
  }
  return {
    fanId: SAMPLE_FAN_ID,
    page: 1,
    snapshotStartedAt: new Date(ANCHOR).toISOString(),
    followingBands: {
      item_cache: { following_bands: cache },
      following_bands: { item_count: followed.length, last_token: `${Math.floor(ANCHOR / 1000)}:1:f::`, sequence: followed.map((page) => String(page.bandId)) },
    },
  };
}

function wishlistPayload(world: World): Record<string, unknown> {
  const items = world.releases.filter((release, index) => index % 37 === 3).slice(0, 8);
  const token = `${Math.floor(ANCHOR / 1000)}::a::`;
  return {
    url: 'https://bandcamp.com/api/fancollection/1/wishlist_items',
    snapshot_started_at: new Date(ANCHOR).toISOString(),
    request: { fan_id: SAMPLE_FAN_ID, older_than_token: token, count: 100 },
    response: {
      items: items.map((release, n) => ({
        item_type: release.itemType === 'a' ? 'album' : 'track',
        item_id: release.itemId,
        tralbum_type: release.itemType,
        tralbum_id: release.itemId,
        band_id: release.page.bandId,
        band_name: release.page.name,
        item_title: release.title,
        item_url: release.url,
        added: wire(ANCHOR - (n + 1) * 3 * DAY),
      })),
      more_available: false,
      last_token: token,
    },
  };
}

function bandDetailsPayloads(world: World): Record<string, unknown>[] {
  return world.pages
    .filter((page) => page.followed)
    .map((page) => ({
      bandId: page.bandId,
      bandDetails: {
        id: page.bandId,
        name: page.name,
        bandcamp_url: page.url,
        image_id: null,
        genre_id: page.genreId,
        discography: world.releases
          .filter((release) => release.page === page)
          .sort((a, b) => b.releaseMs - a.releaseMs)
          .map((release) => ({
            band_id: page.bandId,
            band_name: page.name,
            item_id: release.itemId,
            item_type: release.itemType === 'a' ? 'album' : 'track',
            title: release.title,
            item_url: release.url,
            art_id: null,
            release_date: wire(release.releaseMs),
            is_preorder: release.preorder,
          })),
      },
    }));
}

/** The forty most bought released albums, the ones whose release pages the sample holds. */
function pagedReleases(world: World): Release[] {
  const bought = new Map<number, number>();
  for (const story of world.stories) if (story.kind === 'fp') bought.set(story.release.itemId, (bought.get(story.release.itemId) ?? 0) + 1);
  return world.releases
    .filter((release) => release.itemType === 'a' && !release.preorder)
    .sort((a, b) => (bought.get(b.itemId) ?? 0) - (bought.get(a.itemId) ?? 0) || a.itemId - b.itemId)
    .slice(0, 40);
}

/** The rig's player start: the most bought held album with an unplayable Track and a capped playable one. */
export function sampleShowcase(): RowRelease | null {
  const paged = pagedReleases(makeWorld());
  const release =
    paged.find((r) => r.tracks.some((t) => !t.playable) && r.tracks.some((t) => t.capped && t.playable)) ?? paged[0];
  if (release === undefined) return null;
  return {
    itemType: release.itemType,
    itemId: String(release.itemId),
    title: release.title,
    artist: release.page.name,
    itemUrl: release.url,
    artId: null,
    label: release.label,
    releaseDate: new Date(release.releaseMs).toISOString(),
  };
}

function releasePagePayloads(world: World): Record<string, unknown>[] {
  return pagedReleases(world).map((release) => ({
    itemType: release.itemType,
    itemId: release.itemId,
    itemUrl: release.url,
    tralbum: {
      current: { title: release.title, band_id: release.page.bandId, release_date: wire(release.releaseMs), album_id: release.itemId, id: release.itemId, type: 'album' },
      art_id: null,
      artist: release.page.name,
      item_type: 'album',
      id: release.itemId,
      is_preorder: false,
      album_release_date: wire(release.releaseMs),
      trackinfo: release.tracks.map((track, n) => ({
        id: track.id,
        track_num: n + 1,
        title: track.title,
        duration: track.duration,
        streaming: track.playable ? 1 : null,
        file: track.playable ? { 'mp3-128': `https://t4.sample.local/stream/${track.id}.mp3` } : null,
        is_capped: track.capped ? true : null,
      })),
      url: release.url,
    },
    band: { id: release.page.bandId, name: release.page.name, fan_email: null, account_id: 836_000_000 + release.page.bandId, image_id: null },
  }));
}

/**
 * A pre-order Track as its album page writes it (test/fixtures.ts, read 2026-09-29): one not out has no id, link or
 * file and still says `streaming: 1`.
 */
function preorderTrackEntry(track: Track, trackNum: number, out: boolean): Record<string, unknown> {
  const shared = { track_id: track.id, track_num: trackNum, title: track.title, streaming: 1, is_capped: null };
  if (!out) return { ...shared, id: null, title_link: null, file: null, unreleased_track: true, duration: 0 };
  const file = { 'mp3-128': `https://t4.sample.local/stream/${track.id}.mp3` };
  return { ...shared, id: track.id, title_link: `/track/${slugOf(track.title)}`, file, unreleased_track: false, duration: track.duration };
}

/**
 * Each Drop demo's album page per read, then its Track page, with their fixed fetch moments. The last read is asked
 * again at `freshMs`, so the player holds a page young enough to list (ADR-0015).
 */
function dropDemoDocuments(pages: readonly Page[], freshMs: number): { readonly payload: unknown; readonly fetchedAt: string }[] {
  return dropDemos(pages).flatMap(({ release, publishedMs, reads: fixed, trackPage }) => {
    const last = fixed[fixed.length - 1];
    const reads = last === undefined ? fixed : [...fixed, { atMs: freshMs, out: last.out }];
    const band = { id: release.page.bandId, name: release.page.name, fan_email: null, account_id: 836_000_000 + release.page.bandId, image_id: null };
    const current = { title: release.title, publish_date: wire(publishedMs), band_id: release.page.bandId, release_date: wire(release.releaseMs) };
    const albumReads = reads.map(({ atMs, out }) => ({
      fetchedAt: new Date(atMs).toISOString(),
      payload: {
        itemType: 'a',
        itemId: release.itemId,
        itemUrl: release.url,
        tralbum: {
          current: { ...current, mod_date: wire(atMs - HOUR), album_id: release.itemId, id: release.itemId, type: 'album' },
          art_id: null,
          artist: release.page.name,
          item_type: 'album',
          id: release.itemId,
          is_preorder: true,
          album_release_date: wire(release.releaseMs),
          trackinfo: release.tracks.map((track, n) => preorderTrackEntry(track, n + 1, out.includes(n + 1))),
          url: release.url,
        },
        band,
      },
    }));
    const track = trackPage === undefined ? undefined : release.tracks[trackPage.trackNum - 1];
    if (trackPage === undefined || track === undefined) return albumReads;
    const trackUrl = `${release.page.url}/track/${slugOf(track.title)}`;
    return [
      ...albumReads,
      {
        fetchedAt: new Date(trackPage.atMs).toISOString(),
        payload: {
          itemType: 't',
          itemId: track.id,
          itemUrl: trackUrl,
          tralbum: {
            current: { ...current, title: track.title, mod_date: wire(trackPage.modMs), album_id: release.itemId, id: track.id, type: 'track' },
            item_type: 'track',
            id: track.id,
            is_preorder: null,
            album_is_preorder: true,
            album_release_date: wire(release.releaseMs),
            trackinfo: [preorderTrackEntry(track, trackPage.trackNum, true)],
            url: trackUrl,
          },
          band,
        },
      },
    ];
  });
}

/** Inserts the sample's Raw Documents and folds them; a store with no Fan also gets the sample Fan and a finished first walk. */
export async function loadSampleData(db: SQLiteDatabase): Promise<void> {
  const world = makeWorld();
  const documents: { readonly endpoint: string; readonly payload: unknown }[] = [
    ...feedPayloads(world).map((payload) => ({ endpoint: FEED_UPDATES_ENDPOINT, payload })),
    { endpoint: FOLLOWING_BANDS_ENDPOINT, payload: followingBandsPayload(world) },
    { endpoint: WISHLIST_ITEMS_ENDPOINT, payload: wishlistPayload(world) },
    ...bandDetailsPayloads(world).map((payload) => ({ endpoint: BAND_DETAILS_ENDPOINT, payload })),
    ...releasePagePayloads(world).map((payload) => ({ endpoint: RELEASE_PAGE_ENDPOINT, payload })),
  ];
  const gatheredAt = Date.now() - 12 * 60_000;
  for (const [index, doc] of documents.entries()) {
    await insertRawDocument(db, { ...doc, fetchedAt: new Date(gatheredAt - (documents.length - index) * 200).toISOString() });
  }
  // After the Sweep has dated the demos, and in their own order, which is the order the fold reads them in.
  for (const doc of dropDemoDocuments(world.pages, gatheredAt)) await insertRawDocument(db, { endpoint: RELEASE_PAGE_ENDPOINT, ...doc });
  await fold(db);

  // A store that already holds a Fan keeps it: a foreign identity would pause that Fan's own gathering.
  if ((await readKv<StoredIdentity>(db, IDENTITY_KEY)) !== null) return;
  const identity: StoredIdentity = { fanId: SAMPLE_FAN_ID, username: 'sample', name: 'Sample listener', avatarUrl: null };
  await writeKv(db, IDENTITY_KEY, identity);
  await writeKv(db, CONNECT_SHOWN_KEY, true);
  await writeKv(db, DEVICE_ADDED_KEY, gatheredAt);
  const gather: GatherState = {
    ...EMPTY_GATHER_STATE,
    identity: { fanId: SAMPLE_FAN_ID, username: 'sample' },
    lastTurnAt: gatheredAt,
    lastSuccessAt: gatheredAt,
    initialWalkDone: true,
    storiesSoFar: world.stories.length,
    newestStoryDate: Math.floor((world.stories[0]?.at ?? ANCHOR) / 1000),
    followsFetchedAt: gatheredAt,
    wishlistFetchedAt: gatheredAt,
    wishlistAskedAt: gatheredAt,
  };
  await writeKv(db, GATHER_KEY, gather);
}

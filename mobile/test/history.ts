/**
 * A seeded synthetic history (Stories over Releases, Fans and Pages, some Releases dated only by their public page, a
 * follow list) entered as Raw Documents, and the single wide join the store used to read, kept as the oracle every
 * narrower read must match. Shared by the store's tests and its timing check.
 */
import type { SQLiteDatabase } from 'expo-sqlite';

import type { FeedStoryRow } from '../src/domain/rows';
import { insertRawDocument, type RawDocumentInput } from '../src/store/rawDocuments';

export type HistorySize = {
  readonly pages: number;
  readonly releases: number;
  readonly fans: number;
  readonly purchases: number;
  readonly wishes: number;
};

export const DAY = 86_400_000;

type Release = { readonly type: 'a' | 't'; readonly id: number; readonly band: number; readonly at: number; readonly shown: 'story' | 'page' | 'none' };
type Story = { readonly kind: 'fp' | 'fw' | 'nr'; readonly fan: number | null; readonly release: Release; readonly at: number; readonly why: string | null };

export type History = { readonly releases: readonly Release[]; readonly stories: readonly Story[] };

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Bandcamp's wire form, "18 Aug 2026 07:28:27 GMT". */
export function wireDate(ms: number): string {
  const d = new Date(ms);
  const two = (n: number): string => String(n).padStart(2, '0');
  return `${two(d.getUTCDate())} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()} ${two(d.getUTCHours())}:${two(d.getUTCMinutes())}:${two(d.getUTCSeconds())} GMT`;
}

/**
 * Stories newest first; one Release in 33 is dated 40 days on, so Upcoming has rows. Every track shares its id with the
 * album four places before it: an album and a track can share an id (server migration 0002), and the store keys both.
 * That album is the track's own, so a Track bought before its album's release day counts on the album.
 */
export function makeHistory(size: HistorySize, now: Date): History {
  let seed = 20260925;
  const rand = (): number => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const pick = (n: number, skew: number): number => Math.min(n - 1, Math.floor(n * rand() ** skew));
  const nowMs = now.getTime();

  const releases: Release[] = Array.from({ length: size.releases }, (_, j) => ({
    type: j % 5 === 4 ? 't' : 'a',
    id: 500_000 + j - (j % 5 === 4 ? 4 : 0),
    band: 1000 + (j % size.pages),
    at: nowMs - Math.floor(rand() * 730 * DAY) + (j % 33 === 0 ? 40 * DAY : 0),
    shown: j % 3 !== 0 ? 'story' : j % 2 === 0 ? 'page' : 'none',
  }));

  const stories: Story[] = [];
  for (const release of releases) {
    if (release.shown === 'story') stories.push({ kind: 'nr', fan: null, release, at: Math.min(nowMs - DAY, release.at - Math.floor(rand() * 14 * DAY)), why: null });
  }
  const addPairs = (kind: 'fp' | 'fw', count: number): void => {
    const held = new Set<string>();
    const unreached = kind === 'fp' ? releases.filter((release) => release.shown !== 'story') : [];
    while (held.size < count) {
      const release = unreached.pop() ?? releases[pick(size.releases, 2.2)];
      const fan = 90_000 + pick(size.fans, 1.5);
      if (release === undefined || held.has(`${fan}:${release.type}${release.id}`)) continue;
      held.add(`${fan}:${release.type}${release.id}`);
      const from = Math.max(nowMs - 740 * DAY, Math.min(release.at, nowMs - 60 * DAY));
      const at = from + Math.floor(rand() * (nowMs - from));
      const why = kind === 'fp' && rand() < 0.05 ? `a record I keep returning to ${fan}` : null;
      stories.push({ kind, fan, release, at, why });
    }
  };
  addPairs('fp', size.purchases);
  addPairs('fw', size.wishes);
  stories.sort((a, b) => b.at - a.at);
  return { releases, stories };
}

const TAGS: readonly (readonly [string, string])[] = [
  ['Ambient', 'ambient'], ['Dub', 'dub'], ['Techno', 'techno'], ['Electronic', 'electronic'], ['Drone', 'drone'], ['Jazz', 'jazz'],
];

/** None to three tags by id, and a place on one Release in five, which rows leave out. */
function tagsOf(r: Release): Record<string, unknown>[] {
  const tags = Array.from({ length: r.id % 4 }, (_, i) => {
    const [name, norm] = TAGS[(r.id + i) % TAGS.length] ?? ['Ambient', 'ambient'];
    return { name, norm_name: norm, isloc: false };
  });
  return r.id % 5 === 0 ? [...tags, { name: 'Rotterdam', norm_name: 'rotterdam', isloc: true }] : tags;
}

/**
 * The feed's `band_name`, the artist credit: another artist on the Page, the Page itself, none,
 * or a compilation's, by id.
 */
function creditOf(r: Release): string | undefined {
  return [`Artist ${r.id % 61}`, `Page ${r.band}`, undefined, 'Various Artists'][r.id % 4];
}

function entry(story: Story): Record<string, unknown> {
  const r = story.release;
  const path = r.type === 'a' ? 'album' : 'track';
  return {
    story_type: story.kind,
    story_date: wireDate(story.at),
    fan_id: story.fan,
    band_id: r.band,
    band_name: creditOf(r),
    band_url: `https://page${r.band}.bandcamp.com`,
    item_type: r.type,
    item_id: r.id,
    album_id: r.type === 't' ? r.id : undefined,
    item_title: `Release ${r.id}`,
    item_url: `https://page${r.band}.bandcamp.com/${path}/release-${r.id}`,
    item_art_id: 7_000_000 + r.id,
    label: r.id % 4 === 0 ? `Label ${r.id % 37}` : null,
    price: 7,
    currency: 'EUR',
    featured_track: 8_000_000 + r.id,
    featured_track_title: `Track of ${r.id}`,
    featured_track_duration: 201.5,
    num_streamable_tracks: 6,
    purchased: story.kind === 'fp' ? wireDate(story.at) : undefined,
    new_date: story.kind === 'nr' ? wireDate(r.at) : undefined,
    why: story.why,
    tags: tagsOf(r),
  };
}

export function feedDocument(batch: readonly Story[], fetchedAt: number): RawDocumentInput {
  const fanInfo: Record<string, unknown> = {};
  const bandInfo: Record<string, unknown> = {};
  for (const story of batch) {
    if (story.fan !== null) fanInfo[String(story.fan)] = { username: `fan${story.fan}`, name: `Fan ${story.fan}`, image_id: story.fan % 3 === 0 ? null : 3_000_000 + story.fan };
    bandInfo[String(story.release.band)] = { name: `Page ${story.release.band}`, image_id: 4_000_000 + story.release.band, genre_id: 10 };
  }
  const dates = batch.map((story) => Math.floor(story.at / 1000));
  return {
    endpoint: 'fan_dash_feed_updates',
    payload: { stories: { entries: batch.map(entry), oldest_story_date: Math.min(...dates), newest_story_date: Math.max(...dates) }, fan_info: fanInfo, band_info: bandInfo },
    fetchedAt: new Date(fetchedAt).toISOString(),
  };
}

function releasePageDocument(release: Release, fetchedAt: number): RawDocumentInput {
  return {
    endpoint: 'release_page',
    payload: { itemType: release.type, itemId: release.id, itemUrl: `https://page${release.band}.bandcamp.com/`, tralbum: { current: { release_date: wireDate(release.at) }, artist: `Page artist ${release.id}`, trackinfo: [] }, band: {} },
    fetchedAt: new Date(fetchedAt).toISOString(),
  };
}

/**
 * Enters every Story but the newest `holdBack` in pages of 20, the release pages, and a follow list of the first 250
 * Pages, a second apart from a day before `now`; answers the held-back pages for a later fold. Nothing is folded.
 */
export async function enterHistory(db: SQLiteDatabase, history: History, now: Date, holdBack = 0): Promise<RawDocumentInput[]> {
  const held = history.stories.slice(holdBack);
  const fresh = history.stories.slice(0, holdBack);
  let clock = now.getTime() - DAY;
  for (let i = 0; i < held.length; i += 20) await insertRawDocument(db, feedDocument(held.slice(i, i + 20), (clock += 1000)));
  for (const release of history.releases) if (release.shown === 'page') await insertRawDocument(db, releasePageDocument(release, (clock += 1000)));
  const follows = Object.fromEntries(Array.from({ length: 250 }, (_, i) => [String(1000 + i), { band_id: 1000 + i }]));
  const at = new Date(clock).toISOString();
  await insertRawDocument(db, { endpoint: 'following_bands', payload: { fanId: 1, page: 1, snapshotStartedAt: at, followingBands: { item_cache: { following_bands: follows }, following_bands: { item_count: 250 } } }, fetchedAt: at });
  const later: RawDocumentInput[] = [];
  for (let i = 0; i < fresh.length; i += 20) later.push(feedDocument(fresh.slice(i, i + 20), (clock += 1000)));
  return later;
}

type WideRecord = Record<string, string | number | null>;

/**
 * Every Story row through the one wide join, newest first. With `onAlbums`, a Track Story dated before its held album's
 * release day reads as the album's, found here by its own join and not by the store's reads.
 */
export async function oracleRows(db: SQLiteDatabase, { onAlbums = false }: { readonly onAlbums?: boolean } = {}): Promise<FeedStoryRow[]> {
  const rows = await db.getAllAsync<WideRecord>(
    `with placed as (
       select s.id, s.story_type, s.story_date, s.review_text, s.fan_id,
              case when al.item_id is null then s.item_type else 'a' end as item_type,
              coalesce(al.item_id, s.item_id) as item_id
       from stories s
       left join releases t on ${onAlbums ? "s.item_type = 't'" : '0'} and t.item_type = 't' and t.item_id = s.item_id
       left join releases al on al.item_type = 'a' and al.item_id = t.album_id and s.story_date < al.release_date
     )
     select s.id as story_id, s.story_type, s.story_date, s.review_text, f.fan_id, f.username as fan_username, f.name as fan_name,
            f.image_id as fan_image_id, r.item_type, r.item_id, r.band_id, r.title, r.url, r.art_id, r.release_date, r.label,
            r.featured_track_id, r.featured_track_title, r.featured_track_duration, r.num_streamable_tracks, r.num_tracks, r.is_preorder,
            (r.release_date is not null and (r.release_date_source = 'feed' or r.first_seen_at < r.release_date)) as on_release_day,
            p.name as page_name, r.artist_credit, r.tags
     from placed s join releases r on r.item_type = s.item_type and r.item_id = s.item_id join pages p on p.band_id = r.band_id
     left join fans f on f.fan_id = s.fan_id order by s.story_date desc, s.id desc`,
  );
  const num = (v: string | number | null | undefined): number | null => (typeof v === 'number' ? v : null);
  const str = (v: string | number | null | undefined): string | null => (typeof v === 'string' ? v : null);
  const tags = (v: string | number | null | undefined): FeedStoryRow['tags'] =>
    (JSON.parse(str(v) ?? '[]') as { name: string; normName: string; isLoc: boolean }[])
      .filter((tag) => !tag.isLoc)
      .map(({ name, normName }) => ({ name, normName }));
  return rows.map((row) => ({
    storyId: num(row.story_id) ?? 0,
    storyType: str(row.story_type) as FeedStoryRow['storyType'],
    storyDate: new Date(str(row.story_date) ?? ''),
    reviewText: str(row.review_text),
    fanId: num(row.fan_id),
    fanUsername: str(row.fan_username),
    fanName: str(row.fan_name),
    fanImageId: num(row.fan_image_id),
    itemType: str(row.item_type) as FeedStoryRow['itemType'],
    itemId: num(row.item_id) ?? 0,
    bandId: num(row.band_id) ?? 0,
    title: str(row.title) ?? '',
    url: str(row.url) ?? '',
    artId: num(row.art_id),
    releaseDate: row.release_date === null ? null : new Date(str(row.release_date) ?? ''),
    label: str(row.label),
    featuredTrackId: num(row.featured_track_id),
    featuredTrackTitle: str(row.featured_track_title),
    featuredTrackDuration: num(row.featured_track_duration),
    numStreamableTracks: num(row.num_streamable_tracks),
    numTracks: num(row.num_tracks),
    isPreorder: row.is_preorder === 1,
    onReleaseDay: row.on_release_day === 1,
    pageName: str(row.page_name) ?? '',
    artistCredit: str(row.artist_credit),
    tags: tags(row.tags),
  }));
}

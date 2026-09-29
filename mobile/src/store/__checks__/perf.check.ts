/// <reference types="node" />
/**
 * Times the store's view reads on a long history (task 0036): 10,000 synthetic Stories over 3,000 Releases, 500 Fans and 400 Pages,
 * entered as Raw Documents and folded by the Projection over `node:sqlite`, then each read against the domain rules run on the flat
 * Story rows, which must answer the same. Nothing leaves the machine. Run: `npx tsc src/store/__checks__/perf.check.ts --ignoreConfig
 * --outDir /tmp/wfperf --module commonjs --target es2022 --skipLibCheck --strict --types node && node /tmp/wfperf/store/__checks__/perf.check.js`.
 */
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { performance } from 'node:perf_hooks';
import type { SQLiteDatabase } from 'expo-sqlite';

import { assembleFeed, itemKey } from '../../domain/assemble';
import { buildBoughtChart } from '../../domain/boughtChart';
import { buildCrossedList } from '../../domain/boughtCrossed';
import { buildCurated } from '../../domain/curate';
import { buildNewReleases } from '../../domain/newReleases';
import type { FeedStoryRow } from '../../domain/rows';
import { buildUpcoming } from '../../domain/upcoming';
import { migrate } from '../migrations';
import { fold, rebuild } from '../projection';
import { listStoryRows, listUpcomingReleases, readBought, readCurated, readNewReleases } from '../queries';
import { insertRawDocument } from '../rawDocuments';

class NodeDb {
  readonly d: DatabaseSync;
  constructor(file: string) {
    this.d = new DatabaseSync(file);
  }
  async execAsync(sql: string): Promise<void> {
    this.d.exec(sql);
  }
  async runAsync(sql: string, params: SQLInputValue[] = []): Promise<{ changes: number; lastInsertRowId: number }> {
    const r = this.d.prepare(sql).run(...params);
    return { changes: Number(r.changes), lastInsertRowId: Number(r.lastInsertRowid) };
  }
  async getFirstAsync<T>(sql: string, params: SQLInputValue[] = []): Promise<T | null> {
    return (this.d.prepare(sql).get(...params) as T | undefined) ?? null;
  }
  async getAllAsync<T>(sql: string, params: SQLInputValue[] = []): Promise<T[]> {
    return this.d.prepare(sql).all(...params) as T[];
  }
  async withTransactionAsync(work: () => Promise<void>): Promise<void> {
    await this.withExclusiveTransactionAsync(work);
  }
  async withExclusiveTransactionAsync(work: (txn: NodeDb) => Promise<void>): Promise<void> {
    this.d.exec('begin exclusive');
    try {
      await work(this);
      this.d.exec('commit');
    } catch (error) {
      this.d.exec('rollback');
      throw error;
    }
  }
}

const NOW = new Date(Date.UTC(2026, 8, 25, 12, 0, 0));
const DAY = 86_400_000;
const PAGES = 400;
const RELEASES = 3000;
const FANS = 500;
const PURCHASES = 6000;
const WISHES = 2000;

let seed = 20260925;
function rand(): number {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const pick = (n: number, skew: number): number => Math.min(n - 1, Math.floor(n * rand() ** skew));

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function wireDate(ms: number): string {
  const d = new Date(ms);
  const two = (n: number): string => String(n).padStart(2, '0');
  return `${two(d.getUTCDate())} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()} ${two(d.getUTCHours())}:${two(d.getUTCMinutes())}:${two(d.getUTCSeconds())} GMT`;
}

type Release = { readonly type: 'a' | 't'; readonly id: number; readonly band: number; readonly at: number; readonly shown: 'story' | 'page' | 'none' };
const releases: Release[] = Array.from({ length: RELEASES }, (_, j) => ({
  type: j % 5 === 4 ? 't' : 'a',
  id: 500_000 + j,
  band: 1000 + (j % PAGES),
  at: NOW.getTime() - Math.floor(rand() * 730 * DAY) + (j % 33 === 0 ? 40 * DAY : 0),
  shown: j % 3 !== 0 ? 'story' : j % 2 === 0 ? 'page' : 'none',
}));

type Story = { readonly kind: 'fp' | 'fw' | 'nr'; readonly fan: number | null; readonly release: Release; readonly at: number; readonly why: string | null };
const stories: Story[] = [];
for (const release of releases) {
  if (release.shown === 'story') stories.push({ kind: 'nr', fan: null, release, at: Math.min(NOW.getTime() - DAY, release.at - Math.floor(rand() * 14 * DAY)), why: null });
}
function addPairs(kind: 'fp' | 'fw', count: number): void {
  const held = new Set<string>();
  const unreached = kind === 'fp' ? releases.filter((release) => release.shown !== 'story') : [];
  while (held.size < count) {
    const release = unreached.pop() ?? releases[pick(RELEASES, 2.2)];
    const fan = 90_000 + pick(FANS, 1.5);
    if (release === undefined || held.has(`${fan}:${release.id}`)) continue;
    held.add(`${fan}:${release.id}`);
    const from = Math.max(NOW.getTime() - 740 * DAY, Math.min(release.at, NOW.getTime() - 60 * DAY));
    const at = from + Math.floor(rand() * (NOW.getTime() - from));
    const why = kind === 'fp' && rand() < 0.05 ? `a record I keep returning to ${fan}` : null;
    stories.push({ kind, fan, release, at, why });
  }
}
addPairs('fp', PURCHASES);
addPairs('fw', WISHES);
stories.sort((a, b) => b.at - a.at);

function entry(story: Story): Record<string, unknown> {
  const r = story.release;
  const path = r.type === 'a' ? 'album' : 'track';
  return {
    story_type: story.kind,
    story_date: wireDate(story.at),
    fan_id: story.fan,
    band_id: r.band,
    band_name: `Page ${r.band}`,
    band_url: `https://page${r.band}.bandcamp.com`,
    item_type: r.type,
    item_id: r.id,
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
    tags: [{ name: 'ambient', norm_name: 'ambient', isloc: false }],
  };
}

function feedDocument(batch: readonly Story[], fetchedAt: number): { endpoint: string; payload: unknown; fetchedAt: string } {
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

function releasePageDocument(release: Release, fetchedAt: number): { endpoint: string; payload: unknown; fetchedAt: string } {
  return {
    endpoint: 'release_page',
    payload: { itemType: release.type, itemId: release.id, itemUrl: `https://page${release.band}.bandcamp.com/`, tralbum: { current: { release_date: wireDate(release.at) }, trackinfo: [] }, band: {} },
    fetchedAt: new Date(fetchedAt).toISOString(),
  };
}

type WideRecord = Record<string, string | number | null>;

/** The single wide join the store used to read, kept as the oracle every narrower read must match. */
async function oracleRows(db: SQLiteDatabase): Promise<FeedStoryRow[]> {
  const rows = await db.getAllAsync<WideRecord>(
    `select s.id as story_id, s.story_type, s.story_date, s.review_text, f.fan_id, f.username as fan_username, f.name as fan_name,
            f.image_id as fan_image_id, r.item_type, r.item_id, r.band_id, r.title, r.url, r.art_id, r.release_date, r.label,
            r.featured_track_id, r.featured_track_title, r.featured_track_duration, r.num_streamable_tracks, p.name as artist
     from stories s join releases r on r.item_type = s.item_type and r.item_id = s.item_id join pages p on p.band_id = r.band_id
     left join fans f on f.fan_id = s.fan_id order by s.story_date desc, s.id desc`,
  );
  const num = (v: string | number | null | undefined): number | null => (typeof v === 'number' ? v : null);
  const str = (v: string | number | null | undefined): string | null => (typeof v === 'string' ? v : null);
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
    artist: str(row.artist) ?? '',
  }));
}

async function time<T>(label: string, work: () => Promise<T>, runs = 5): Promise<T> {
  let answer = await work();
  const spent: number[] = [];
  for (let i = 0; i < runs; i += 1) {
    const start = performance.now();
    answer = await work();
    spent.push(performance.now() - start);
  }
  spent.sort((a, b) => a - b);
  console.log(`${label.padEnd(28)} median ${(spent[Math.floor(runs / 2)] ?? 0).toFixed(1).padStart(7)} ms   max ${(spent[runs - 1] ?? 0).toFixed(1).padStart(7)} ms`);
  return answer;
}

function same(label: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${label.padEnd(28)} ${ok ? 'same as the domain rules' : 'DIFFERS from the domain rules'}`);
  if (!ok) process.exitCode = 1;
}

async function main(): Promise<void> {
  const file = join(tmpdir(), 'wavfeed-perf.db');
  for (const suffix of ['', '-wal', '-shm']) rmSync(file + suffix, { force: true });
  const node = new NodeDb(file);
  node.d.exec('pragma journal_mode = wal');
  const db = node as unknown as SQLiteDatabase;
  await migrate(db);

  same('empty store, curated', await readCurated(db), buildCurated([]));
  same('empty store, bought', await readBought(db, { mode: 'released', now: NOW }), { weeks: [], nextCursor: null });
  same('empty store, new releases', await readNewReleases(db, { now: NOW }), buildNewReleases([], [], NOW));

  const held = stories.slice(100);
  const fresh = stories.slice(0, 100);
  let clock = NOW.getTime() - DAY;
  const buildStart = performance.now();
  for (let i = 0; i < held.length; i += 20) await insertRawDocument(db, feedDocument(held.slice(i, i + 20), (clock += 1000)));
  for (const release of releases) if (release.shown === 'page') await insertRawDocument(db, releasePageDocument(release, (clock += 1000)));
  const follows = Object.fromEntries(Array.from({ length: 250 }, (_, i) => [String(1000 + i), { band_id: 1000 + i }]));
  await insertRawDocument(db, { endpoint: 'following_bands', payload: { fanId: 1, page: 1, snapshotStartedAt: new Date(clock).toISOString(), followingBands: { item_cache: { following_bands: follows }, following_bands: { item_count: 250 } } }, fetchedAt: new Date(clock).toISOString() });
  await fold(db);
  const count = async (table: string): Promise<number> => (await db.getFirstAsync<{ n: number }>(`select count(*) as n from ${table}`))?.n ?? 0;
  console.log(`built in ${((performance.now() - buildStart) / 1000).toFixed(1)} s: stories ${await count('stories')}, releases ${await count('releases')}, fans ${await count('fans')}, pages ${await count('pages')}, raw ${await count('raw_documents')}`);

  await time('listStoryRows', () => listStoryRows(db));
  const rows = await oracleRows(db);
  const newReleases = await time('readNewReleases', () => readNewReleases(db, { now: NOW }));
  const released = await time('readBought released', () => readBought(db, { mode: 'released', now: NOW }));
  const crossed = await time('readBought crossed 2', () => readBought(db, { mode: 'crossed', threshold: 2, now: NOW }));
  const curated = await time('readCurated', () => readCurated(db));

  await time('rules only: bought', async () => buildBoughtChart(rows));
  await time('rules only: crossed 2', async () => buildCrossedList(rows, 2));
  await time('rules only: curated', async () => buildCurated(rows));
  const { elements } = assembleFeed(rows, { types: ['new_release'], sort: 'anchor' });
  const upcomingRows = await listUpcomingReleases(db, NOW);
  const wanted = new Set(upcomingRows.map(itemKey));
  same('readNewReleases', newReleases, buildNewReleases(elements, buildUpcoming(upcomingRows, rows.filter((row) => wanted.has(itemKey(row)))), NOW));
  same('readBought released', released, { weeks: buildBoughtChart(rows), nextCursor: null });
  same('readBought crossed 2', crossed, { entries: buildCrossedList(rows, 2), nextCursor: null });
  for (const threshold of [3, 5, 10]) {
    same(`readBought crossed ${threshold}`, await readBought(db, { mode: 'crossed', threshold, now: NOW }), { entries: buildCrossedList(rows, threshold), nextCursor: null });
  }
  const earlier = new Date(NOW.getTime() - 200 * DAY);
  const earlierUpcoming = await listUpcomingReleases(db, earlier);
  const earlierWanted = new Set(earlierUpcoming.map(itemKey));
  same('readNewReleases 200 days ago', await readNewReleases(db, { now: earlier }), buildNewReleases(elements, buildUpcoming(earlierUpcoming, rows.filter((row) => earlierWanted.has(itemKey(row)))), earlier));
  same('readCurated', curated, buildCurated(rows));
  console.log(`sizes: new release weeks ${newReleases.weeks.length}, upcoming ${newReleases.upcoming.length}, bought weeks ${released.weeks.length}, crossed ${crossed.entries.length}, curated ${curated.boughtByFollowed.length}/${curated.newFromPages.length}/${curated.inTheirOwnWords.length}`);

  for (let i = 0; i < fresh.length; i += 20) await insertRawDocument(db, feedDocument(fresh.slice(i, i + 20), (clock += 1000)));
  const foldStart = performance.now();
  const summary = await fold(db);
  console.log(`${'fold of 5 documents'.padEnd(28)} ${(performance.now() - foldStart).toFixed(1).padStart(14)} ms   (${summary.documentsProcessed} documents, ${summary.storiesUpserted} stories)`);

  const beforeRebuild = JSON.stringify(await readBought(db, { mode: 'released', now: NOW }));
  const rebuildStart = performance.now();
  await rebuild(db);
  console.log(`${'rebuild'.padEnd(28)} ${(performance.now() - rebuildStart).toFixed(1).padStart(14)} ms`);
  const afterRows = await oracleRows(db);
  same('bought after rebuild', JSON.parse(beforeRebuild), await readBought(db, { mode: 'released', now: NOW }));
  same('curated after rebuild', await readCurated(db), buildCurated(afterRows));
  node.d.close();
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});

/**
 * The pure half of the Projection: `fan_dash_feed_updates` in, Fans, Pages, Releases and Stories out (ADR-0004).
 * Ported from server/packages/projection/src/parse.ts (task 0036).
 */
import type {
  ItemType,
  MutableSkippedCounts,
  ParsedFan,
  ParsedFeedUpdates,
  ParsedPage,
  ParsedRelease,
  ParsedStory,
  ReleaseTag,
  StoryType,
} from './types';
import { noSkips } from './types';
import { asRecord, readDate, readId, readText } from './wire';

const STORY_TYPES: Readonly<Record<string, StoryType>> = {
  fp: 'purchase',
  fw: 'wishlist',
  nr: 'new_release',
};

/**
 * Codes Bandcamp's own feed renders that name no Release a followed Fan or Page acted on: `np` a stranger "also
 * bought", `df` a Discover pick, `bp` a full discography, `nf`, `fs`, `st` and `sm` follows, subscriptions and
 * messages. Dropped without counting, so `unknownStoryType` counts only codes nobody has read yet (task 0045).
 */
const IGNORED_STORY_TYPES: ReadonlySet<string> = new Set(['np', 'df', 'bp', 'nf', 'fs', 'st', 'sm']);

export class FeedPayloadError extends Error {
  override readonly name = 'FeedPayloadError';
}

function readTextOrNull(source: Record<string, unknown>, key: string): string | null {
  return readText(source, key) ?? null;
}

function readIdOrNull(source: Record<string, unknown>, key: string): number | null {
  return readId(source, key) ?? null;
}

function readDecimalOrNull(source: Record<string, unknown>, key: string): number | null {
  const value = source[key];
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed === '') return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function readTags(value: unknown): readonly ReleaseTag[] {
  if (!Array.isArray(value)) return [];
  const tags: ReleaseTag[] = [];
  for (const raw of value) {
    const record = asRecord(raw);
    if (record === undefined) continue;
    const name = readText(record, 'name');
    if (name === undefined) continue;
    tags.push({ name, normName: readText(record, 'norm_name') ?? name, isLoc: record.isloc === true });
  }
  return tags;
}

/** A merch entry ("p") names the merch item in item_*, and the Release in tralbum_*. */
const MERCH_ITEM_TYPE = 'p';

type ReleaseIdentity = { readonly itemType: ItemType; readonly itemId: number };

function asItemType(value: string | undefined): ItemType | undefined {
  return value === 'a' || value === 't' ? value : undefined;
}

function readReleaseIdentity(
  entry: Record<string, unknown>,
  wireItemType: string | undefined,
): ReleaseIdentity | undefined {
  const isMerch = wireItemType === MERCH_ITEM_TYPE;
  const itemType = asItemType(isMerch ? readText(entry, 'tralbum_type') : wireItemType);
  const itemId = readId(entry, isMerch ? 'tralbum_id' : 'item_id');
  return itemType === undefined || itemId === undefined ? undefined : { itemType, itemId };
}

function readReleaseTitle(
  entry: Record<string, unknown>,
  wireItemType: string | undefined,
): string | undefined {
  return wireItemType === MERCH_ITEM_TYPE
    ? (readText(entry, 'album_title') ?? readText(entry, 'item_title'))
    : readText(entry, 'item_title');
}

function mergeFan(existing: ParsedFan, next: ParsedFan): ParsedFan {
  return {
    fanId: existing.fanId,
    username: next.username,
    name: next.name ?? existing.name,
    location: next.location ?? existing.location,
    imageId: next.imageId ?? existing.imageId,
  };
}

function mergePage(existing: ParsedPage, next: ParsedPage): ParsedPage {
  return {
    bandId: existing.bandId,
    name: next.name,
    url: next.url ?? existing.url,
    imageId: next.imageId ?? existing.imageId,
    genreId: next.genreId ?? existing.genreId,
  };
}

function mergeRelease(existing: ParsedRelease, next: ParsedRelease): ParsedRelease {
  return {
    itemType: existing.itemType,
    itemId: existing.itemId,
    bandId: next.bandId,
    title: next.title,
    url: next.url,
    albumId: next.albumId ?? existing.albumId,
    albumTitle: next.albumTitle ?? existing.albumTitle,
    artId: next.artId ?? existing.artId,
    releaseDate: next.releaseDate ?? existing.releaseDate,
    label: next.label ?? existing.label,
    labelId: next.labelId ?? existing.labelId,
    artistCredit: next.artistCredit ?? existing.artistCredit,
    price: next.price ?? existing.price,
    currency: next.currency ?? existing.currency,
    featuredTrackId: next.featuredTrackId ?? existing.featuredTrackId,
    featuredTrackTitle: next.featuredTrackTitle ?? existing.featuredTrackTitle,
    featuredTrackDuration: next.featuredTrackDuration ?? existing.featuredTrackDuration,
    numStreamableTracks: next.numStreamableTracks ?? existing.numStreamableTracks,
    alsoCollectedCount: next.alsoCollectedCount ?? existing.alsoCollectedCount,
    isPreorder: next.isPreorder,
    tags: next.tags.length > 0 ? next.tags : existing.tags,
  };
}

function mergeStory(existing: ParsedStory, next: ParsedStory): ParsedStory {
  return { ...next, reviewText: next.reviewText ?? existing.reviewText };
}

function releaseKey(itemType: ItemType, itemId: number): string {
  return `${itemType}:${itemId}`;
}

function storyKey(story: ParsedStory): string {
  return `${story.storyType}:${story.fanId ?? ''}:${story.itemType}:${story.itemId}`;
}

type EntryContext = {
  readonly fanInfo: Record<string, unknown>;
  readonly bandInfo: Record<string, unknown>;
  readonly skipped: MutableSkippedCounts;
};

type ParsedEntry = {
  readonly fan: ParsedFan | undefined;
  readonly page: ParsedPage;
  readonly release: ParsedRelease;
  readonly story: ParsedStory;
};

function readFan(entry: Record<string, unknown>, context: EntryContext): ParsedFan | 'unparsable' | 'missing' {
  const fanId = readId(entry, 'fan_id');
  if (fanId === undefined) return 'unparsable';
  const info = asRecord(context.fanInfo[String(fanId)]);
  const username = info === undefined ? undefined : readText(info, 'username');
  if (info === undefined || username === undefined) return 'missing';
  return {
    fanId,
    username,
    name: readTextOrNull(info, 'name'),
    location: readTextOrNull(info, 'location'),
    imageId: readIdOrNull(info, 'image_id'),
  };
}

function readEntry(rawEntry: unknown, context: EntryContext): ParsedEntry | undefined {
  const { skipped } = context;
  const entry = asRecord(rawEntry);
  const wireType = entry === undefined ? undefined : readText(entry, 'story_type');
  if (entry === undefined || wireType === undefined) {
    skipped.unparsable += 1;
    return undefined;
  }
  const storyType = STORY_TYPES[wireType];
  if (storyType === undefined) {
    if (!IGNORED_STORY_TYPES.has(wireType)) skipped.unknownStoryType += 1;
    return undefined;
  }

  const wireItemType = readText(entry, 'item_type');
  const identity = readReleaseIdentity(entry, wireItemType);
  const bandId = readId(entry, 'band_id');
  const title = readReleaseTitle(entry, wireItemType);
  const url = readText(entry, 'item_url');
  const storyDate = readDate(entry, 'story_date');
  if (identity === undefined || bandId === undefined || title === undefined || url === undefined || storyDate === undefined) {
    skipped.unparsable += 1;
    return undefined;
  }

  const band = asRecord(context.bandInfo[String(bandId)]);
  const pageName = (band === undefined ? undefined : readText(band, 'name')) ?? readText(entry, 'band_name');
  if (pageName === undefined) {
    skipped.unparsable += 1;
    return undefined;
  }

  let fan: ParsedFan | undefined;
  if (storyType !== 'new_release') {
    const read = readFan(entry, context);
    if (read === 'unparsable') skipped.unparsable += 1;
    if (read === 'missing') skipped.missingFanInfo += 1;
    if (typeof read === 'string') return undefined;
    fan = read;
  }

  const actionDate = storyType === 'purchase' ? (readDate(entry, 'purchased') ?? storyDate) : storyDate;
  // A pre-order's story date is the day its page went public, weeks before it is out, so its release page dates it
  // (task 0041, decision 1).
  const isPreorder = entry.is_preorder === true;
  const releaseDate = storyType === 'new_release' && !isPreorder ? (readDate(entry, 'new_date') ?? storyDate) : null;

  return {
    fan,
    page: {
      bandId,
      name: pageName,
      url: readTextOrNull(entry, 'band_url'),
      imageId: band === undefined ? null : readIdOrNull(band, 'image_id'),
      genreId: band === undefined ? null : readIdOrNull(band, 'genre_id'),
    },
    release: {
      itemType: identity.itemType,
      itemId: identity.itemId,
      bandId,
      title,
      url,
      albumId: readIdOrNull(entry, 'album_id'),
      albumTitle: readTextOrNull(entry, 'album_title'),
      artId: readIdOrNull(entry, 'item_art_id'),
      releaseDate,
      label: readTextOrNull(entry, 'label'),
      labelId: readIdOrNull(entry, 'label_id'),
      // `band_name` is the Release's artist credit; `band_info` names the Page (task 0071, decision 18).
      artistCredit: readTextOrNull(entry, 'band_name'),
      price: readDecimalOrNull(entry, 'price'),
      currency: readTextOrNull(entry, 'currency'),
      featuredTrackId: readIdOrNull(entry, 'featured_track'),
      featuredTrackTitle: readTextOrNull(entry, 'featured_track_title'),
      featuredTrackDuration: readDecimalOrNull(entry, 'featured_track_duration'),
      numStreamableTracks: readIdOrNull(entry, 'num_streamable_tracks'),
      alsoCollectedCount: readIdOrNull(entry, 'also_collected_count'),
      isPreorder,
      tags: readTags(entry.tags),
    },
    story: {
      storyType,
      fanId: fan?.fanId ?? null,
      itemType: identity.itemType,
      itemId: identity.itemId,
      storyDate: actionDate,
      reviewText: storyType === 'new_release' ? null : readTextOrNull(entry, 'why'),
    },
  };
}

/**
 * Parses one `fan_dash_feed_updates` payload. An unreadable entry is counted in
 * `skipped`; only a payload with no `stories.entries` array throws.
 */
export function parseFeedUpdates(payload: unknown): ParsedFeedUpdates {
  const root = asRecord(payload);
  const entries = asRecord(root?.stories)?.entries;
  if (!Array.isArray(entries)) {
    throw new FeedPayloadError('payload is not a fan_dash_feed_updates document: stories.entries is not an array');
  }

  const context: EntryContext = {
    fanInfo: asRecord(root?.fan_info) ?? {},
    bandInfo: asRecord(root?.band_info) ?? {},
    skipped: noSkips(),
  };
  const fans = new Map<number, ParsedFan>();
  const pages = new Map<number, ParsedPage>();
  const releases = new Map<string, ParsedRelease>();
  const stories = new Map<string, ParsedStory>();

  for (const rawEntry of entries) {
    const parsed = readEntry(rawEntry, context);
    if (parsed === undefined) continue;
    const { fan, page, release, story } = parsed;

    if (fan !== undefined) {
      const known = fans.get(fan.fanId);
      fans.set(fan.fanId, known === undefined ? fan : mergeFan(known, fan));
    }
    const knownPage = pages.get(page.bandId);
    pages.set(page.bandId, knownPage === undefined ? page : mergePage(knownPage, page));
    const key = releaseKey(release.itemType, release.itemId);
    const knownRelease = releases.get(key);
    releases.set(key, knownRelease === undefined ? release : mergeRelease(knownRelease, release));
    const knownStory = stories.get(storyKey(story));
    stories.set(storyKey(story), knownStory === undefined ? story : mergeStory(knownStory, story));
  }

  return {
    fans: [...fans.values()],
    pages: [...pages.values()],
    releases: [...releases.values()],
    stories: [...stories.values()],
    skipped: context.skipped,
  };
}

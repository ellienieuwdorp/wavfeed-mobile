/**
 * A hand-run check of the feed parser and the de-noise rules on a three-Story payload (fp, nr, fw), with synthetic Fans and Pages.
 * Run: npx tsc src/domain/__checks__/parse.check.ts --ignoreConfig --outDir /tmp/wfcheck --module commonjs --target es2022 --skipLibCheck && node /tmp/wfcheck/__checks__/parse.check.js
 */
import { assembleFeed, ALL_STORY_TYPES } from '../assemble';
import { sha256Hex } from '../hash';
import { parseFeedUpdates } from '../parse';
import type { FeedStoryRow } from '../rows';
import type { ParsedFeedUpdates } from '../types';

const BAND_ID = 3820115;
const OTHER_BAND_ID = 4410023;
const FAN_ID = 2214537;
const OTHER_FAN_ID = 990211;

function entry(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    story_date: '18 Aug 2026 07:28:27 GMT',
    fan_id: FAN_ID,
    band_id: BAND_ID,
    band_name: 'Nightgraft',
    band_url: 'https://nightgraft.bandcamp.com',
    item_type: 'a',
    item_id: 4102938475,
    item_title: 'Slow Harbour',
    item_url: 'https://nightgraft.bandcamp.com/album/slow-harbour',
    item_art_id: 1204871,
    tags: [{ name: 'Ambient', norm_name: 'ambient', isloc: false }],
    label: 'Halfmoon Tapes',
    price: 7.5,
    currency: 'EUR',
    featured_track: 55501122,
    featured_track_title: 'Low Tide',
    featured_track_duration: 314.52,
    num_streamable_tracks: 8,
    is_preorder: false,
    ...overrides,
  };
}

const payload = {
  stories: {
    entries: [
      entry({ story_type: 'fp', purchased: '17 Aug 2026 21:04:11 GMT', why: 'tape hiss done right' }),
      entry({
        story_type: 'nr',
        band_id: OTHER_BAND_ID,
        band_name: 'Kite Season',
        item_id: 5120000001,
        item_title: 'Ferrous',
        item_url: 'https://kiteseason.bandcamp.com/album/ferrous',
        new_date: '14 Aug 2026 00:00:00 GMT',
      }),
      entry({ story_type: 'fw', fan_id: OTHER_FAN_ID, story_date: '19 Aug 2026 10:00:00 GMT' }),
    ],
    oldest_story_date: 1755475200,
    newest_story_date: 1755597600,
  },
  fan_info: {
    [String(FAN_ID)]: { fan_id: FAN_ID, username: 'diggerfan', name: 'Digger', image_id: 88123456 },
    [String(OTHER_FAN_ID)]: { fan_id: OTHER_FAN_ID, username: 'mara.dj', name: null },
  },
  band_info: {
    [String(BAND_ID)]: { band_id: BAND_ID, name: 'Nightgraft Recordings', genre_id: 10, image_id: 40118822 },
  },
};

/** The rows the store's join would hand over, built straight from the parse. */
function toRows(parsed: ParsedFeedUpdates): FeedStoryRow[] {
  return parsed.stories.map((story, index) => {
    const release = parsed.releases.find((r) => r.itemType === story.itemType && r.itemId === story.itemId);
    const page = parsed.pages.find((p) => p.bandId === release?.bandId);
    const fan = parsed.fans.find((f) => f.fanId === story.fanId);
    if (release === undefined || page === undefined) throw new Error('a Story names a Release the parse did not return');
    return {
      storyId: index + 1,
      storyType: story.storyType,
      storyDate: story.storyDate,
      reviewText: story.reviewText,
      fanId: story.fanId,
      fanUsername: fan?.username ?? null,
      fanName: fan?.name ?? null,
      fanImageId: fan?.imageId ?? null,
      itemType: release.itemType,
      itemId: release.itemId,
      bandId: release.bandId,
      title: release.title,
      url: release.url,
      artId: release.artId,
      releaseDate: release.releaseDate,
      label: release.label,
      featuredTrackId: release.featuredTrackId,
      featuredTrackTitle: release.featuredTrackTitle,
      featuredTrackDuration: release.featuredTrackDuration,
      numStreamableTracks: release.numStreamableTracks,
      artist: page.name,
    };
  });
}

const parsed = parseFeedUpdates(payload);
console.log('parse', {
  fans: parsed.fans.length,
  pages: parsed.pages.length,
  releases: parsed.releases.length,
  stories: parsed.stories.map((s) => `${s.storyType} fan=${s.fanId ?? '-'} ${s.itemType}:${s.itemId}`),
  skipped: parsed.skipped,
});

const { elements, typeCounts } = assembleFeed(toRows(parsed), { types: ALL_STORY_TYPES, sort: 'activity' });
console.log('assemble', { typeCounts, elements: elements.length });
for (const element of elements) {
  if (element.kind !== 'item') continue;
  console.log(' ', element.title, '·', element.artist, {
    buyers: element.buyers.map((f) => f.username),
    wishlisters: element.wishlisters.map((f) => f.username),
    hasNewRelease: element.hasNewRelease,
    reviews: element.reviews.map((r) => r.text),
    releaseDate: element.releaseDate,
    anchorDate: element.anchorDate,
  });
}

console.log('sha256("abc")', sha256Hex('abc') === 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad' ? 'ok' : 'WRONG');
console.log('sha256("")', sha256Hex('') === 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855' ? 'ok' : 'WRONG');

/// <reference types="node" />
/**
 * `fan_dash_feed_updates` in, Fans, Pages, Releases and Stories out (ADR-0004): the wire codes `fp`, `fw` and `nr`, a
 * merch purchase credited to the Release it presses (ADR-0005), release dates only where a new-release Story states one
 * (ADR-0011), and every entry it cannot read counted and dropped without costing its siblings. Ported from the server's
 * suite (task 0036).
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  BAND_ID,
  FAN_ID,
  fanInfo,
  feedPayload,
  fpEntry,
  fwEntry,
  ITEM_ID,
  nrEntry,
  OTHER_FAN_ID,
  pEntry,
} from '../../test/fixtures';
import { FeedPayloadError, parseFeedUpdates } from './parse';

const STORY_AT = new Date('2026-08-18T07:28:27Z');
const PURCHASED_AT = new Date('2026-08-17T21:04:11Z');
const NEW_AT = new Date('2026-08-14T00:00:00Z');
const NO_SKIPS = { unknownStoryType: 0, unparsable: 0, missingFanInfo: 0 };

/** Asserts a single result and hands it back. */
function only<T>(items: readonly T[]): T {
  assert.equal(items.length, 1);
  return items[0] as T;
}

function parseEntries(...entries: unknown[]) {
  return parseFeedUpdates(feedPayload({ entries }));
}

describe('purchases', () => {
  test('records the buying Fan, the Page and the Story, dated at the purchase', () => {
    const result = parseEntries(fpEntry());

    assert.deepEqual(only(result.fans), {
      fanId: FAN_ID,
      username: 'diggerfan',
      name: 'Digger',
      location: 'Rotterdam, Netherlands',
      imageId: 88123456,
    });
    assert.deepEqual(only(result.stories), {
      storyType: 'purchase',
      fanId: FAN_ID,
      itemType: 'a',
      itemId: ITEM_ID,
      storyDate: PURCHASED_AT,
      reviewText: null,
    });
    assert.deepEqual(only(result.pages), {
      bandId: BAND_ID,
      name: 'Nightgraft Recordings',
      url: 'https://nightgraft.bandcamp.com',
      imageId: 40118822,
      genreId: 10,
    });
    assert.deepEqual(result.skipped, NO_SKIPS);
  });

  test('carries the Release through with its tags and no release date (ADR-0011)', () => {
    assert.deepEqual(only(parseEntries(fpEntry()).releases), {
      itemType: 'a',
      itemId: ITEM_ID,
      bandId: BAND_ID,
      title: 'Slow Harbour',
      url: 'https://nightgraft.bandcamp.com/album/slow-harbour',
      albumId: ITEM_ID,
      albumTitle: 'Slow Harbour',
      artId: 1204871,
      releaseDate: null,
      label: 'Halfmoon Tapes',
      labelId: 771204,
      price: 7.5,
      currency: 'EUR',
      featuredTrackId: 55501122,
      featuredTrackTitle: 'Low Tide',
      featuredTrackDuration: 314.52,
      numStreamableTracks: 8,
      alsoCollectedCount: 12,
      isPreorder: false,
      tags: [
        { name: 'Ambient', normName: 'ambient', isLoc: false },
        { name: 'Rotterdam', normName: 'rotterdam', isLoc: true },
      ],
    });
  });

  test('reads a preorder flag when Bandcamp set it', () => {
    assert.equal(only(parseEntries(fpEntry({ is_preorder: true })).releases).isPreorder, true);
  });
});

describe('merch purchases', () => {
  test('credits a vinyl purchase to the Release it presses (ADR-0005)', () => {
    const result = parseEntries(pEntry());

    const release = only(result.releases);
    assert.deepEqual(
      [release.itemType, release.itemId, release.title, release.url, release.albumId],
      ['a', ITEM_ID, 'Slow Harbour', 'https://nightgraft.bandcamp.com/album/slow-harbour', ITEM_ID],
    );
    assert.deepEqual(only(result.stories), {
      storyType: 'purchase',
      fanId: FAN_ID,
      itemType: 'a',
      itemId: ITEM_ID,
      storyDate: PURCHASED_AT,
      reviewText: null,
    });
    assert.deepEqual(result.skipped, NO_SKIPS);
  });

  test("takes the merch item's own title only when there is no album title", () => {
    assert.equal(only(parseEntries(pEntry({ album_title: null })).releases).title, 'Slow Harbour 12" vinyl');
  });

  test("handles a track's merch through tralbum_type", () => {
    const release = only(parseEntries(pEntry({ tralbum_type: 't', tralbum_id: 5150 })).releases);

    assert.deepEqual([release.itemType, release.itemId], ['t', 5150]);
  });

  test('counts a merch entry that names no readable Release as unparsable', () => {
    const result = parseEntries(
      pEntry({ tralbum_id: undefined }),
      pEntry({ tralbum_type: undefined }),
      pEntry({ tralbum_type: 'p' }),
      pEntry({ tralbum_id: 'not-an-id' }),
    );

    assert.deepEqual(result.skipped, { ...NO_SKIPS, unparsable: 4 });
    assert.deepEqual(result.releases, []);
    assert.deepEqual(result.stories, []);
  });

  test('merges a merch purchase into the Release its new-release Story created', () => {
    const result = parseEntries(nrEntry(), pEntry());

    const release = only(result.releases);
    assert.equal(release.title, 'Slow Harbour');
    assert.deepEqual(release.releaseDate, NEW_AT);
    // The merch price wins the shared field.
    assert.equal(release.price, 24);
    assert.deepEqual(result.stories.map((story) => story.storyType), ['new_release', 'purchase']);
    assert.equal(only(result.pages).bandId, BAND_ID);
  });
});

describe('new releases', () => {
  test('gives a new-release Story no actor, though the entry carries a fan_id', () => {
    const result = parseEntries(nrEntry());

    assert.deepEqual(result.fans, []);
    assert.deepEqual(only(result.stories), {
      storyType: 'new_release',
      fanId: null,
      itemType: 'a',
      itemId: ITEM_ID,
      storyDate: STORY_AT,
      reviewText: null,
    });
  });

  test('dates the Release by new_date, and by the story date when new_date is null (ADR-0011)', () => {
    assert.deepEqual(only(parseEntries(nrEntry()).releases).releaseDate, NEW_AT);
    assert.deepEqual(only(parseEntries(nrEntry({ new_date: null })).releases).releaseDate, STORY_AT);
  });
});

describe('wishlists', () => {
  test('maps fw to a wishlist Story dated at its story date, with no release date', () => {
    const result = parseEntries(fwEntry());

    assert.deepEqual(only(result.stories), {
      storyType: 'wishlist',
      fanId: FAN_ID,
      itemType: 'a',
      itemId: ITEM_ID,
      storyDate: STORY_AT,
      reviewText: null,
    });
    assert.equal(only(result.releases).releaseDate, null);
    assert.equal(only(result.fans).username, 'diggerfan');
  });
});

describe('review text', () => {
  test('keeps the words a Fan wrote, trimmed, and reads a blank one as none', () => {
    const cases: readonly [unknown, string | null][] = [
      ['the tape that got me through August', 'the tape that got me through August'],
      ['  perfect  ', 'perfect'],
      ['   ', null],
      [null, null],
      [undefined, null],
    ];
    for (const [why, expected] of cases) {
      assert.equal(only(parseEntries(fpEntry({ why })).stories).reviewText, expected, String(why));
    }
  });

  test('keeps a wishlist Story its review, and gives a new release none', () => {
    assert.equal(only(parseEntries(fwEntry({ why: 'saving up' })).stories).reviewText, 'saving up');
    // Nobody acted on a new release, so there is nobody whose words those would be.
    assert.equal(only(parseEntries(nrEntry({ why: 'out now' })).stories).reviewText, null);
  });

  test('does not unsay a review when a later entry for the same Story omits it', () => {
    // One payload can carry the same Story twice, and only one copy may have the words (ADR-0004).
    const result = parseEntries(fpEntry({ why: 'album of the year' }), fpEntry());

    assert.equal(only(result.stories).reviewText, 'album of the year');
  });
});

describe('entries it refuses', () => {
  test('counts a story type it does not understand and keeps the rest of the page', () => {
    const result = parseEntries(fpEntry({ story_type: 'xx' }), nrEntry());

    assert.deepEqual(result.skipped, { ...NO_SKIPS, unknownStoryType: 1 });
    assert.equal(only(result.stories).storyType, 'new_release');
  });

  test('counts a malformed entry without aborting its siblings (ADR-0004)', () => {
    const result = parseEntries(
      fpEntry({ item_id: undefined }),
      nrEntry({ story_date: 'sometime last week' }),
      fwEntry({ item_type: 'x' }),
      fpEntry({ item_type: 'q' }),
      'not an entry at all',
      nrEntry({ item_id: 777, item_title: '  ' }),
      fpEntry(),
    );

    assert.deepEqual(result.skipped, { ...NO_SKIPS, unparsable: 6 });
    assert.equal(only(result.stories).storyType, 'purchase');
  });

  test('skips an actor with no usable fan_info record, emitting neither Fan nor Story', () => {
    const cases: readonly [string, Record<string, unknown>][] = [
      ['no record', {}],
      ['no username', { [String(FAN_ID)]: fanInfo({ username: null }) }],
    ];
    for (const [label, info] of cases) {
      const result = parseFeedUpdates(feedPayload({ entries: [fpEntry()], fanInfo: info }));

      assert.deepEqual(result.skipped, { ...NO_SKIPS, missingFanInfo: 1 }, label);
      assert.deepEqual(result.fans, [], label);
      assert.deepEqual(result.stories, [], label);
    }
  });

  test('skips an entry whose Page has no name anywhere', () => {
    const result = parseFeedUpdates(feedPayload({ entries: [nrEntry({ band_name: null })], bandInfo: {} }));

    assert.deepEqual(result.skipped, { ...NO_SKIPS, unparsable: 1 });
    assert.deepEqual(result.pages, []);
  });

  test('returns empty collections for a page with no entries left', () => {
    assert.deepEqual(parseEntries(), { fans: [], pages: [], releases: [], stories: [], skipped: NO_SKIPS });
  });
});

describe('Pages', () => {
  test("falls back to the entry's band_name when band_info knows nothing", () => {
    const result = parseFeedUpdates(feedPayload({ entries: [nrEntry()], bandInfo: {} }));

    assert.deepEqual(only(result.pages), {
      bandId: BAND_ID,
      name: 'Nightgraft',
      url: 'https://nightgraft.bandcamp.com',
      imageId: null,
      genreId: null,
    });
  });
});

describe('dedupe within one payload', () => {
  test('merges one Release seen in several entries, filling nulls from later ones', () => {
    const release = only(
      parseEntries(fpEntry({ label: null, label_id: null, also_collected_count: 3 }), nrEntry({ also_collected_count: 9 }))
        .releases,
    );

    assert.equal(release.label, 'Halfmoon Tapes');
    assert.equal(release.labelId, 771204);
    assert.deepEqual(release.releaseDate, NEW_AT);
    assert.equal(release.alsoCollectedCount, 9);
  });

  test('keeps a field a later entry no longer reports', () => {
    const release = only(parseEntries(nrEntry(), fpEntry({ label: null, item_art_id: null, new_date: null })).releases);

    assert.equal(release.label, 'Halfmoon Tapes');
    assert.equal(release.artId, 1204871);
    // A purchase never nulls out a release date a new-release Story taught us (ADR-0011).
    assert.deepEqual(release.releaseDate, NEW_AT);
  });

  test('collapses the same Story repeated across overlapping entries', () => {
    const result = parseEntries(fpEntry(), fpEntry(), fpEntry());

    assert.equal(result.stories.length, 1);
    assert.equal(result.fans.length, 1);
    assert.equal(result.pages.length, 1);
    assert.equal(result.releases.length, 1);
  });

  test('keeps two Fans buying the same Release as two Stories', () => {
    const result = parseFeedUpdates(
      feedPayload({
        entries: [fpEntry(), fpEntry({ fan_id: OTHER_FAN_ID })],
        fanInfo: {
          [String(FAN_ID)]: fanInfo(),
          [String(OTHER_FAN_ID)]: fanInfo({ fan_id: OTHER_FAN_ID, username: 'tapehead', name: null, location: null }),
        },
      }),
    );

    assert.deepEqual(result.stories.map((story) => story.fanId), [FAN_ID, OTHER_FAN_ID]);
    assert.equal(result.releases.length, 1);
    assert.deepEqual(result.fans.map((fan) => fan.username), ['diggerfan', 'tapehead']);
  });

  test('keeps an album and a track with the same item_id apart', () => {
    const result = parseEntries(nrEntry(), nrEntry({ item_type: 't', item_title: 'Low Tide' }));

    assert.deepEqual(result.releases.map((release) => release.itemType), ['a', 't']);
    assert.equal(result.stories.length, 2);
  });
});

describe('tags', () => {
  test('drops a malformed tag and keeps the readable ones, and reads a non-list as none', () => {
    const tags = [
      { name: 'Dub Techno', norm_name: 'dub-techno', isloc: false },
      { norm_name: 'no-name-here', isloc: false },
      'techno',
      null,
      { name: 'Drone' },
    ];

    assert.deepEqual(only(parseEntries(nrEntry({ tags })).releases).tags, [
      { name: 'Dub Techno', normName: 'dub-techno', isLoc: false },
      { name: 'Drone', normName: 'Drone', isLoc: false },
    ]);
    assert.deepEqual(only(parseEntries(nrEntry({ tags: 'ambient' })).releases).tags, []);
  });
});

describe('wire quirks', () => {
  test('accepts ids sent as numeric strings', () => {
    const result = parseEntries(fpEntry({ item_id: '4102938475', band_id: '3820115', fan_id: '2214537' }));

    const story = only(result.stories);
    assert.deepEqual([story.itemId, story.fanId], [ITEM_ID, FAN_ID]);
    assert.equal(only(result.pages).bandId, BAND_ID);
  });

  test('refuses an id that is not a safe integer', () => {
    assert.deepEqual(parseEntries(nrEntry({ item_id: '9007199254740993' })).skipped, { ...NO_SKIPS, unparsable: 1 });
  });

  test('treats an unreadable optional date as absent and keeps the entry', () => {
    const result = parseEntries(fpEntry({ purchased: 'not a date' }));

    assert.deepEqual(result.skipped, NO_SKIPS);
    assert.deepEqual(only(result.stories).storyDate, STORY_AT);
  });
});

describe('payloads that are not a feed', () => {
  test('throws for anything without a stories.entries array', () => {
    const payloads: readonly unknown[] = [
      { ok: false, error_message: 'unauthorized' },
      { stories: { entries: null } },
      // A fan_feed_page payload: callers route Raw Documents by endpoint.
      { url: 'https://bandcamp.com/diggerfan/feed', status: 200, bytes: 312_408 },
      null,
      '{}',
      [],
    ];
    for (const payload of payloads) {
      assert.throws(() => parseFeedUpdates(payload), FeedPayloadError, JSON.stringify(payload));
    }
  });
});

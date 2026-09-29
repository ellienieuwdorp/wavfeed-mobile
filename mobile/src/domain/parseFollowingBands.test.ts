/// <reference types="node" />
/**
 * One page of a follow-list walk, in both of its shapes: the fan page embeds its first batch keyed by band id, and
 * every continuation answers with an `items` array. A parser that knew only one would hold half a follow list, and a
 * page called the end of a walk too early would let the fold sweep live follows (ADR-0017). Ported from the server's
 * suite (task 0036).
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { BAND_ID, FAN_ID, FOLLOW_SNAPSHOT_AT, followingBandsFirstPage, followingBandsPage } from '../../test/fixtures';
import { FollowingBandsPayloadError, parseFollowingBands } from './parseFollowingBands';

describe('parseFollowingBands', () => {
  test('reads the batch a first page embeds, and calls a batch that holds the whole list the end', () => {
    assert.deepEqual(parseFollowingBands(followingBandsFirstPage([BAND_ID, 771204])), {
      fanId: FAN_ID,
      page: 1,
      snapshotStartedAt: new Date(FOLLOW_SNAPSHOT_AT),
      // The batch is an object keyed by band id, and JavaScript walks integer keys in ascending order, so this is
      // the document's order as anything can read it.
      bandIds: [771204, BAND_ID],
      terminal: true,
      skipped: { unknownStoryType: 0, unparsable: 0, missingFanInfo: 0 },
    });
  });

  test("reads a continuation page's items array", () => {
    const parsed = parseFollowingBands(followingBandsPage([771204, 990211], 2));

    assert.equal(parsed.page, 2);
    assert.deepEqual(parsed.bandIds, [771204, 990211]);
  });

  test('takes the id off the key when the entry does not repeat it', () => {
    const parsed = parseFollowingBands({
      fanId: FAN_ID,
      page: 1,
      followingBands: { item_cache: { following_bands: { '771204': { name: 'Halfmoon' } } } },
    });

    assert.deepEqual(parsed.bandIds, [771204]);
  });

  test('holds one follow for a band the page listed twice', () => {
    const parsed = parseFollowingBands({
      fanId: FAN_ID,
      page: 3,
      followingBands: { items: [{ band_id: BAND_ID }, { id: BAND_ID }], more_available: false },
    });

    assert.deepEqual(parsed.bandIds, [BAND_ID]);
    assert.equal(parsed.skipped.unparsable, 0, 'an entry that names its band by id is read, not dropped');
  });

  test('counts and drops the entries that name no band', () => {
    const parsed = parseFollowingBands({
      fanId: FAN_ID,
      page: 2,
      followingBands: { items: [{ band_id: BAND_ID }, { name: 'nameless' }, 'nonsense'] },
    });

    assert.deepEqual(parsed.bandIds, [BAND_ID]);
    assert.equal(parsed.skipped.unparsable, 2);
  });

  test('reads an empty follow list as a complete walk', () => {
    // An account can follow nobody, and somebody who unfollowed their last Page has to be swept against an empty list.
    const parsed = parseFollowingBands(followingBandsPage([]));

    assert.deepEqual(parsed.bandIds, []);
    assert.equal(parsed.terminal, true);
  });

  test('does not call a page the end unless it says so', () => {
    // Only reaching the end earns a sweep; an answer that does not say leaves the fold additive, which costs a stale
    // follow and never an emptied list.
    const longList = followingBandsFirstPage([BAND_ID]);
    const followingBands = longList.followingBands as Record<string, unknown>;
    followingBands.following_bands = { item_count: 900, last_token: '1787045307:1:f::' };
    const silent = { fanId: FAN_ID, page: 2, followingBands: { items: [{ band_id: BAND_ID }] } };

    assert.equal(parseFollowingBands(longList).terminal, false, 'a first page shorter than the list');
    assert.equal(parseFollowingBands(silent).terminal, false, 'a continuation with no more_available');
  });

  test('reads a page stored before the envelope carried a snapshot start', () => {
    const parsed = parseFollowingBands({
      fanId: FAN_ID,
      page: 1,
      followingBands: { item_cache: { following_bands: { '771204': { name: 'Halfmoon' } } } },
    });

    // Null, so the fold stamps the document's own fetch time and sweeps nothing.
    assert.equal(parsed.snapshotStartedAt, null);
  });

  test('refuses a payload that is neither shape', () => {
    assert.throws(() => parseFollowingBands({ fanId: FAN_ID, page: 1 }), FollowingBandsPayloadError);
    assert.throws(
      () => parseFollowingBands({ fanId: FAN_ID, page: 1, followingBands: { more_available: true } }),
      FollowingBandsPayloadError,
    );
  });
});

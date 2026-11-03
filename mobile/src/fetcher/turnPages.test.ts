/// <reference types="node" />
/** Gather turns reading public pages: release pages, Upcoming Releases with the Track pages their Drops owe, and the band details sweep. */
import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';

import { BAND_ID, bandDetailsPayload, discographyItem, feedPayload, PREORDER_ITEM_ID, PREORDER_URL, preorderNrEntry, preorderTrackPurchase, preorderTrackId, preorderTrackPageBlob, preorderTralbumBlob, purchaseAt, releasePagePayload } from '../../test/fixtures';
import { rig, resetRig, REQUEST_MS, DAY_S, stories, ok, at, datedPage, turn, followBands } from '../../test/gatherRig';
import type { ReleasePage } from '../bandcamp/session';
import type { BandcampAnswer } from '../bandcamp/wire';
import { BACKOFF_MS, markReleasePageAttempt, readUndatedReleases, RETRY_AFTER_MS } from '../store/enrichment';
import { fold } from '../store/projection';
import { listDrops, listUpcomingReleases } from '../store/queries';
import { insertRawDocument } from '../store/rawDocuments';

beforeEach(resetRig);

describe('release pages', () => {
  test("only a page's own refusal counts against it, and any failure ends the pass", async () => {
    rig.feed = stories(3, 1000);
    rig.releasePage = () => ({ kind: 'error', status: 503 });
    await turn();
    assert.equal(rig.releasePages.length, 1);
    assert.equal((await readUndatedReleases(rig.db, 10, new Date(rig.clock))).length, 3);

    rig.releasePage = () => ({ kind: 'error', status: 400 });
    await turn(600_000, 'timer');
    assert.equal(rig.releasePages.length, 2);
    assert.deepEqual((await readUndatedReleases(rig.db, 10, new Date(rig.clock))).map((release) => release.itemId), [1001, 1002]);
  });
});

describe('Upcoming Releases', () => {
  const albumPage = (out: readonly number[]) =>
    releasePagePayload({ itemId: PREORDER_ITEM_ID, itemUrl: PREORDER_URL, tralbum: preorderTralbumBlob({}, out) });
  const trackPage = (itemId: number): BandcampAnswer<ReleasePage> => {
    const tralbum = preorderTrackPageBlob(3, '04 Oct 2026 20:36:00 GMT');
    return ok({ kind: 'page', document: { endpoint: 'release_page', payload: releasePagePayload({ itemType: 't', itemId, tralbum }), fetchedAt: at() } });
  };
  const dropDays = async () => (await listDrops(rig.db)).map((drop) => [drop.day, drop.tracksOut]);

  /** Held from four days back: the feed's pre-order and its page, one Track playing; its page now plays a second. */
  async function holdPreorder(): Promise<void> {
    rig.clock = Date.UTC(2026, 9, 5, 12);
    const heldAt = new Date(Date.UTC(2026, 9, 1, 8)).toISOString();
    await insertRawDocument(rig.db, { endpoint: 'fan_dash_feed_updates', payload: feedPayload({ entries: [preorderNrEntry()] }), fetchedAt: heldAt });
    await insertRawDocument(rig.db, { endpoint: 'release_page', payload: albumPage([2]), fetchedAt: heldAt });
    await fold(rig.db);
    rig.releasePage = (itemId, itemType) => {
      if (itemType === 'a' && itemId !== PREORDER_ITEM_ID) return datedPage(itemId);
      if (itemType === 'a') return ok({ kind: 'page', document: { endpoint: 'release_page', payload: albumPage([2, 3]), fetchedAt: at() } });
      return trackPage(itemId);
    };
  }

  test('owed Tracks and Upcoming reads progress under an undated backlog within the walking and caught-up quotas', async () => {
    await holdPreorder();
    await insertRawDocument(rig.db, { endpoint: 'release_page', payload: albumPage([2, 3]), fetchedAt: '2026-10-03T12:00:00.000Z' });
    await fold(rig.db);
    rig.feed = stories(70, 1000);
    assert.equal((await turn()).outcome, 'done');
    assert.equal(rig.releasePages.length, 5);
    assert.ok(rig.releasePages.includes(preorderTrackId(3)), 'an owed Drop Track gets a slot despite the undated backlog');
    assert.ok(rig.releasePages.includes(PREORDER_ITEM_ID), 'a stale Upcoming album gets a slot too');
    assert.ok(rig.releasePages.some((id) => id >= 1000 && id < 1070), 'undated history also progresses');

    // Another Track comes out while ordinary history still fills more than a turn.
    rig.clock += 2 * DAY_S * 1000;
    rig.releasePages = [];
    rig.releasePage = (itemId, itemType) => itemType === 'a' && itemId === PREORDER_ITEM_ID
      ? ok({ kind: 'page', document: { endpoint: 'release_page', payload: albumPage([2, 3, 4]), fetchedAt: at() } })
      : itemType === 't' ? trackPage(itemId) : datedPage(itemId);
    await turn();
    assert.equal(rig.releasePages.length, 25);
    assert.ok(rig.releasePages.includes(PREORDER_ITEM_ID));
    assert.ok(rig.releasePages.includes(preorderTrackId(4)), 'new Drop work shares the same quota');
    assert.equal(new Set(rig.releasePages).size, rig.releasePages.length, 'the pass does not ask a page twice');
  });

  test('a walking turn reserves time for owed and Upcoming pages when no undated Release is held', async () => {
    await holdPreorder();
    await insertRawDocument(rig.db, { endpoint: 'release_page', payload: albumPage([2, 3]), fetchedAt: '2026-10-03T12:00:00.000Z' });
    await fold(rig.db);
    assert.deepEqual(await readUndatedReleases(rig.db, 5, new Date(rig.clock)), []);
    rig.feed = stories(100, 1000);
    const summary = await turn(10 * REQUEST_MS);
    assert.equal(summary.outcome, 'out_of_budget');
    assert.equal(summary.walkPending, true);
    assert.ok(rig.releasePages.includes(preorderTrackId(3)), 'the feed leaves room for the owed Track');
    assert.ok(rig.releasePages.includes(PREORDER_ITEM_ID), 'the feed leaves room for the Upcoming album');
    assert.ok(rig.releasePages.length <= 5);
  });

  test('new Drop Track pages cannot consume the allowance before another planned Upcoming album', async () => {
    await holdPreorder();
    const manyTracks = (playing: boolean) => Array.from({ length: 30 }, (_, i) => ({
      id: playing ? 9000 + i : null, track_id: 9000 + i, track_num: i + 1, title: `Track ${i + 1}`,
      streaming: 1, unreleased_track: !playing,
      file: playing ? { 'mp3-128': `https://stream.invalid/${9000 + i}` } : null,
      title_link: playing ? `/track/t${9000 + i}` : null,
    }));
    const otherId = 7000;
    await insertRawDocument(rig.db, {
      endpoint: 'fan_dash_feed_updates', payload: feedPayload({ entries: [preorderNrEntry({ item_id: otherId, item_url: 'https://nightgraft.bandcamp.com/album/other' })] }),
      fetchedAt: '2026-10-01T08:00:00.000Z',
    });
    await insertRawDocument(rig.db, { endpoint: 'release_page', payload: releasePagePayload({ itemId: PREORDER_ITEM_ID, itemUrl: PREORDER_URL, tralbum: preorderTralbumBlob({ trackinfo: manyTracks(false) }) }), fetchedAt: '2026-10-01T09:00:00.000Z' });
    await insertRawDocument(rig.db, { endpoint: 'release_page', payload: releasePagePayload({ itemId: otherId, tralbum: preorderTralbumBlob() }), fetchedAt: '2026-10-02T09:00:00.000Z' });
    await fold(rig.db);
    await rig.sink.patchGatherState({ initialWalkDone: true });
    rig.releasePage = (itemId, itemType) => {
      if (itemType === 'a' && itemId === PREORDER_ITEM_ID) return ok({ kind: 'page', document: { endpoint: 'release_page', payload: releasePagePayload({ itemId, itemUrl: PREORDER_URL, tralbum: preorderTralbumBlob({ trackinfo: manyTracks(true) }) }), fetchedAt: at() } });
      if (itemType === 't') return ok({ kind: 'page', document: { endpoint: 'release_page', payload: releasePagePayload({
        itemType, itemId, itemUrl: `https://nightgraft.bandcamp.com/track/t${itemId}`,
        tralbum: { current: { id: itemId, album_id: PREORDER_ITEM_ID, mod_date: '04 Oct 2026 20:36:00 GMT' }, album_release_date: '13 Oct 2026 00:00:00 GMT', album_url: '/album/moth-season', trackinfo: [manyTracks(true)[itemId - 9000]] },
      }), fetchedAt: at() } });
      return datedPage(itemId);
    };

    await turn();
    assert.ok(rig.releasePages.includes(otherId), 'a second Upcoming album is read before nested Drop pages spend the pass');
    assert.equal(rig.releasePages.length, 25);
    assert.equal(new Set(rig.releasePages).size, 25);
    const requested = new Set(rig.releasePages);
    const answerPage = rig.releasePage;
    rig.releasePages = [];
    rig.releasePage = () => ({ kind: 'error', status: 503 });
    await turn();
    assert.equal(rig.releasePages.length, 1, 'a refused request stops the deferred pass');
    const deferred = rig.releasePages[0];
    assert.ok(deferred !== undefined);
    assert.ok(!requested.has(deferred), 'the quota left this Track unread');

    rig.releasePages = [];
    rig.releasePage = answerPage;
    await turn();
    assert.equal(rig.releasePages.length, 7, 'the next pass dates all seven Tracks the quota left');
    assert.ok(rig.releasePages.every((itemId) => itemId >= 9000 && itemId < 9030 && !requested.has(itemId)));
  });

  for (const { newest, heldParent } of [
    { newest: false, heldParent: false }, { newest: true, heldParent: false }, { newest: true, heldParent: true },
  ]) {
    test(`an early Track ${heldParent ? 'with its parent already queued behind six albums' : newest ? 'at the head' : 'behind ordinary history'} completes its future album in the same bounded pass`, async () => {
      rig.clock = Date.UTC(2026, 9, 12, 12);
      const trackId = preorderTrackId(2);
      const trackUrl = 'https://label.example/track/early-track';
      const albumUrl = 'https://label.example/album/future-ep';
      const albumDate = '06 Nov 2026 00:00:00 GMT';
      const purchase = preorderTrackPurchase(2, {
        is_preorder: false, item_url: trackUrl, album_title: 'Future EP',
        story_date: newest ? '12 Oct 2026 11:30:00 GMT' : '02 Oct 2026 18:19:06 GMT',
        purchased: newest ? '12 Oct 2026 11:30:00 GMT' : '02 Oct 2026 18:19:06 GMT',
      });
      await insertRawDocument(rig.db, {
        endpoint: 'fan_dash_feed_updates', payload: feedPayload({ entries: [purchase, ...Array.from({ length: 60 }, (_, i) => purchaseAt(1000 + i, Date.UTC(2026, 9, 11, 12) / 1000 - i))] }),
        fetchedAt: at(),
      });
      await fold(rig.db);
      if (heldParent) {
        await followBands([BAND_ID]);
        await insertRawDocument(rig.db, { endpoint: 'band_details', fetchedAt: at(), payload: bandDetailsPayload({ items: [
          ...Array.from({ length: 6 }, (_, i) => discographyItem({ item_id: 8000 + i, release_date: albumDate, item_url: `https://label.example/album/other-${i}` })),
          discographyItem({ item_id: PREORDER_ITEM_ID, release_date: albumDate, item_url: albumUrl }),
        ] }) });
        await fold(rig.db);
        assert.equal((await rig.sink.readUpcomingDue(rig.clock, 25))[6]?.itemId, PREORDER_ITEM_ID, 'the parent is already in the planned Upcoming queue');
        await rig.sink.patchGatherState({ initialWalkDone: true });
        rig.bandDetails = ok({ kind: 'gone', status: 404 });
      }
      const trackBlob = { ...preorderTrackPageBlob(2, '05 Oct 2026 14:50:50 GMT'), album_release_date: albumDate, album_url: '/album/future-ep' };
      const baseAlbum = preorderTralbumBlob();
      const albumBlob = {
        ...baseAlbum, album_release_date: albumDate,
        current: { ...(baseAlbum.current as Record<string, unknown>), release_date: albumDate },
        trackinfo: [...(baseAlbum.trackinfo as unknown[]), { id: null, track_id: 9991, track_num: 5, title: 'Not out', streaming: 1, unreleased_track: true, file: null }],
      };
      rig.releasePage = (itemId, itemType) => {
        if (itemType === 't') return ok({ kind: 'page', document: { endpoint: 'release_page', payload: releasePagePayload({ itemType, itemId, itemUrl: trackUrl, tralbum: trackBlob }), fetchedAt: at() } });
        if (itemId === PREORDER_ITEM_ID) return ok({ kind: 'page', document: { endpoint: 'release_page', payload: releasePagePayload({ itemId, itemUrl: albumUrl, tralbum: albumBlob }), fetchedAt: at() } });
        return datedPage(itemId);
      };

      await turn(heldParent ? 6 * REQUEST_MS : 600_000);
      assert.ok(rig.releasePages.includes(trackId), 'known absent-parent Tracks are reached before unrelated undated history');
      assert.ok(rig.releasePages.includes(PREORDER_ITEM_ID), 'the Track evidence schedules the album page inside this pass');
      assert.equal(rig.releasePageUrls[rig.releasePages.indexOf(PREORDER_ITEM_ID)], albumUrl, 'use the URL stated by the Track page');
      assert.equal(rig.releasePages.length, 5);
      const album = (await listUpcomingReleases(rig.db, new Date(rig.clock))).find((release) => release.itemId === PREORDER_ITEM_ID);
      assert.ok(album);
      assert.deepEqual([album.numStreamableTracks, album.numTracks], [1, 5]);
      if (heldParent) {
        assert.equal(rig.releasePages.filter((itemId) => itemId === PREORDER_ITEM_ID).length, 1, 'promotion does not duplicate the parent request');
      }
    });
  }

  for (const scenario of [
    { name: 'missing album title', purchase: { album_title: null }, page: {}, failures: 0 },
    { name: 'missing album URL', purchase: {}, page: { album_url: null }, failures: 0 },
    { name: 'album date is not future', purchase: {}, page: { album_release_date: '12 Oct 2026 00:00:00 GMT' }, failures: 0 },
    { name: 'failed album attempt waits a day', purchase: {}, page: {}, failures: 1 },
    { name: 'three failed album attempts wait a week', purchase: {}, page: {}, failures: 3 },
  ]) {
    test(`early Track follow-up respects ${scenario.name}`, async () => {
      rig.clock = Date.UTC(2026, 9, 12, 12);
      const trackId = preorderTrackId(2);
      await insertRawDocument(rig.db, { endpoint: 'fan_dash_feed_updates', payload: feedPayload({ entries: [preorderTrackPurchase(2, { is_preorder: false, ...scenario.purchase })] }), fetchedAt: at() });
      await fold(rig.db);
      for (let failure = 0; failure < scenario.failures; failure += 1) {
        await markReleasePageAttempt(rig.db, { itemType: 'a', itemId: PREORDER_ITEM_ID }, 'failed', new Date(rig.clock));
      }
      const baseAlbum = preorderTralbumBlob();
      const albumDate = '06 Nov 2026 00:00:00 GMT';
      rig.releasePage = (itemId, itemType) => ok({ kind: 'page', document: { endpoint: 'release_page', fetchedAt: at(), payload: releasePagePayload({
        itemType, itemId,
        tralbum: itemType === 't'
          ? { ...preorderTrackPageBlob(2, '05 Oct 2026 14:50:50 GMT'), album_release_date: albumDate, ...scenario.page }
          : { ...baseAlbum, album_release_date: albumDate, current: { ...(baseAlbum.current as Record<string, unknown>), release_date: albumDate } },
      }) } });

      await turn();
      assert.deepEqual(rig.releasePages, [trackId], 'the admitted Track does not authorize this album request yet');
      const held = await rig.db.getFirstAsync<{ num_tracks: number | null }>("select num_tracks from releases where item_type = 'a' and item_id = ?", [PREORDER_ITEM_ID]);
      assert.deepEqual(held === null ? null : { ...held }, scenario.failures > 0 ? { num_tracks: null } : null);
      if (scenario.failures > 0) {
        rig.clock += scenario.failures === 3 ? BACKOFF_MS : RETRY_AFTER_MS;
        rig.releasePages = [];
        await turn();
        assert.deepEqual(rig.releasePages, [PREORDER_ITEM_ID], 'the due parent is read after its established wait');
      }
    });
  }

  test('a page a day old is read again after the undated, with the Track pages of the Tracks it let out', async () => {
    await holdPreorder();
    rig.feed = stories(1, 1000);
    await turn();
    assert.deepEqual(rig.releasePages, [1000, PREORDER_ITEM_ID, preorderTrackId(3)]);
    assert.equal(rig.releasePageUrls[2], 'https://nightgraft.bandcamp.com/track/wing-dust');
    assert.deepEqual(await dropDays(), [['2026-10-04', 2], ['2026-09-29', 1]], 'the Track page dates the Drop the read found');

    rig.releasePages = [];
    await turn(600_000, 'timer');
    assert.deepEqual(rig.releasePages, [], 'read today, and the feed names no more');
  });

  test('a Track page the budget or a refusal left unread is asked on a later turn, and dates the Drop then', async () => {
    await holdPreorder();
    rig.feed = stories(1, 1000);
    const answerPage = rig.releasePage;
    rig.releasePage = (itemId, itemType) => {
      const answer = answerPage(itemId, itemType);
      if (itemId === PREORDER_ITEM_ID) rig.clock += 600_000;
      return answer;
    };
    assert.equal((await turn()).outcome, 'out_of_budget');
    assert.deepEqual(rig.releasePages, [1000, PREORDER_ITEM_ID]);
    assert.deepEqual(await dropDays(), [['2026-10-05', 2], ['2026-09-29', 1]]);

    rig.releasePages = [];
    rig.releasePage = () => ({ kind: 'error', status: 503 });
    await turn(600_000, 'timer');
    assert.deepEqual(rig.releasePages, [preorderTrackId(3)]);

    rig.releasePages = [];
    rig.releasePage = (itemId) => trackPage(itemId);
    await turn(600_000, 'timer');
    assert.deepEqual(rig.releasePages, [preorderTrackId(3)]);
    assert.equal(rig.releasePageUrls.at(-1), 'https://nightgraft.bandcamp.com/track/wing-dust');
    assert.deepEqual(await dropDays(), [['2026-10-04', 2], ['2026-09-29', 1]]);

    rig.releasePages = [];
    await turn(600_000, 'timer');
    assert.deepEqual(rig.releasePages, [], 'the Drop owes no Track page');
  });
});

describe('the band details sweep', () => {
  test('a 429 stops sweeping until the breaker cools down (ADR-0017)', async () => {
    await followBands([1, 2, 3, 4]);

    await turn();
    assert.deepEqual(rig.bandDetailsAsked, [1]);
    assert.equal(rig.gather.lastError, 'bandcamp_error');
    rig.clock += 60_000;
    await turn();
    assert.deepEqual(rig.bandDetailsAsked, [1], 'still cooling down a minute on');
  });
});

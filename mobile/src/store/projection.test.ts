/// <reference types="node" />
/**
 * Where a Release's date comes from (task 0041, decision 1; ADR-0011 amended): a release page or the Sweep outranks the
 * feed, the newer of a page and a Sweep wins, a Release the feed once named a pre-order takes no date from the feed, and
 * the Raw Documents' fold order never changes which date is held.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  bandDetailsPayload,
  discographyItem,
  feedPayload,
  ITEM_ID,
  nrEntry,
  PREORDER_ITEM_ID,
  PREORDER_URL,
  preorderNrEntry,
  preorderTralbumBlob,
  releasePagePayload,
} from '../../test/fixtures';
import { openTestStore } from '../../test/nodeDb';
import { BAND_DETAILS_ENDPOINT, FEED_UPDATES_ENDPOINT, RELEASE_PAGE_ENDPOINT } from '../domain/endpoints';
import { readUndatedReleases } from './enrichment';
import { fold } from './projection';
import { listStoryRows } from './queries';
import { insertRawDocument, type RawDocumentInput } from './rawDocuments';

/** The feed says 14 August, the page 5 August, the Sweep 20 August. */
const FEED_DAY = '2026-08-14T00:00:00.000Z';
const PAGE_DAY = '2026-08-05T00:00:00.000Z';
const SWEEP_DAY = '2026-08-20T00:00:00.000Z';

function feedRead(fetchedAt: string, collected: number): RawDocumentInput {
  return { endpoint: FEED_UPDATES_ENDPOINT, payload: feedPayload({ entries: [nrEntry({ also_collected_count: collected })] }), fetchedAt };
}

function pageRead(fetchedAt: string): RawDocumentInput {
  return { endpoint: RELEASE_PAGE_ENDPOINT, payload: releasePagePayload(), fetchedAt };
}

function sweepRead(fetchedAt: string): RawDocumentInput {
  const item = discographyItem({
    item_id: ITEM_ID,
    title: 'Slow Harbour',
    item_url: 'https://nightgraft.bandcamp.com/album/slow-harbour',
    release_date: '20 Aug 2026 00:00:00 GMT',
    is_preorder: false,
  });
  return { endpoint: BAND_DETAILS_ENDPOINT, payload: bandDetailsPayload({ items: [item] }), fetchedAt };
}

function preorderFeedRead(fetchedAt: string, isPreorder: boolean, playing: number): RawDocumentInput {
  const entry = preorderNrEntry({ is_preorder: isPreorder, num_streamable_tracks: playing });
  return { endpoint: FEED_UPDATES_ENDPOINT, payload: feedPayload({ entries: [entry] }), fetchedAt };
}

function preorderPageRead(fetchedAt: string): RawDocumentInput {
  const payload = releasePagePayload({ itemId: PREORDER_ITEM_ID, itemUrl: PREORDER_URL, tralbum: preorderTralbumBlob() });
  return { endpoint: RELEASE_PAGE_ENDPOINT, payload, fetchedAt };
}

/**
 * Folds the reads in the order given, one fold each, and answers the date the Release's Story row carries and the
 * Releases due a release page read at `now`.
 */
async function held(reads: readonly RawDocumentInput[], now = new Date(Date.UTC(2026, 9, 14, 12))) {
  const { db, close } = await openTestStore();
  for (const read of reads) {
    await insertRawDocument(db, read);
    await fold(db);
  }
  const [row] = await listStoryRows(db);
  const due = (await readUndatedReleases(db, 10, now)).map((release) => release.itemId);
  close();
  return { date: row?.releaseDate?.toISOString() ?? null, due };
}

async function heldDate(reads: readonly RawDocumentInput[]): Promise<string | null> {
  return (await held(reads)).date;
}

test('a release page date outlasts the feed, whichever of them folds last', async () => {
  const first = feedRead('2026-09-01T00:00:00.000Z', 12);
  const page = pageRead('2026-09-02T00:00:00.000Z');
  const later = feedRead('2026-09-04T00:00:00.000Z', 13);

  assert.equal(await heldDate([first]), FEED_DAY);
  assert.equal(await heldDate([first, page, later]), PAGE_DAY);
  assert.equal(await heldDate([later, page, first]), PAGE_DAY);
});

test('between a release page and the Sweep the newer read wins, in either fold order, and the feed moves neither', async () => {
  const first = feedRead('2026-09-01T00:00:00.000Z', 12);
  const page = pageRead('2026-09-02T00:00:00.000Z');
  const sweep = sweepRead('2026-09-03T00:00:00.000Z');
  const later = feedRead('2026-09-04T00:00:00.000Z', 13);
  const newerPage = pageRead('2026-09-05T00:00:00.000Z');

  assert.equal(await heldDate([first, page, sweep, later]), SWEEP_DAY);
  assert.equal(await heldDate([sweep, later, page, first]), SWEEP_DAY);
  assert.equal(await heldDate([first, sweep, newerPage, later]), PAGE_DAY);
  assert.equal(await heldDate([later, newerPage, sweep]), PAGE_DAY);
});

test('a page read and a Sweep read fetched in the same moment hold one date, in either fold order', async () => {
  const first = feedRead('2026-09-01T00:00:00.000Z', 12);
  const page = pageRead('2026-09-02T00:00:00.000Z');
  const sweep = sweepRead('2026-09-02T00:00:00.000Z');

  assert.equal(await heldDate([first, page, sweep]), await heldDate([first, sweep, page]));
  assert.equal(await heldDate([sweep, first, page]), await heldDate([page, first, sweep]));
});

test('a pre-order whose feed entry is rewritten as out waits undated for its release page, in either fold order', async () => {
  const announced = preorderFeedRead('2026-09-29T10:00:00.000Z', true, 1);
  const rewritten = preorderFeedRead('2026-10-14T10:00:00.000Z', false, 4);
  const page = preorderPageRead('2026-10-14T11:00:00.000Z');

  assert.deepEqual(await held([announced, rewritten]), { date: null, due: [PREORDER_ITEM_ID] });
  assert.deepEqual(await held([rewritten, announced]), { date: null, due: [PREORDER_ITEM_ID] });
  assert.deepEqual(await held([announced, rewritten, page]), { date: '2026-10-13T00:00:00.000Z', due: [] });
  assert.deepEqual(await held([rewritten, page, announced]), { date: '2026-10-13T00:00:00.000Z', due: [] });
});

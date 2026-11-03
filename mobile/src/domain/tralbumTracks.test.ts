/// <reference types="node" />
/**
 * Reading a tracklist out of a `data-tralbum` blob (ADR-0015): a real-shaped blob yields what the player needs, and no
 * shape of blob, however sparse or broken, stops a Release from rendering, since stored documents are never rewritten
 * (ADR-0004).
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { readTralbumTracks } from './tralbumTracks';

const streamUrl = (trackId: number) => `https://t4.bcbits.com/stream/1f4e9c0b8a/mp3-128/${trackId}?p=0&ts=1790000000`;

const ALBUM = {
  trackinfo: [
    { id: 55501122, track_num: 1, title: 'Low Tide', duration: 314.52, streaming: 1, is_capped: null, file: { 'mp3-128': streamUrl(55501122) } },
    { id: 55501123, track_num: 2, title: 'Harbour Lights', duration: 421.08, streaming: 1, is_capped: 1, file: { 'mp3-128': streamUrl(55501123) } },
    { id: 55501124, track_num: 3, title: 'Breakwater', duration: 288.0, streaming: null, is_capped: null, file: null },
  ],
};

describe('readTralbumTracks', () => {
  test("reads a track page's single Track with its stream URL", () => {
    const tralbum = { trackinfo: [ALBUM.trackinfo[0]], album_is_preorder: false };
    assert.deepEqual(readTralbumTracks(tralbum), [
      { trackId: '55501122', trackNum: 1, title: 'Low Tide', duration: 314.52, streamUrl: streamUrl(55501122), capped: false, out: true, path: null },
    ]);
  });

  test('tells a streamable Track, a capped one and an unstreamable one apart', () => {
    assert.deepEqual(
      readTralbumTracks(ALBUM).map((track) => [track.trackNum, track.streamUrl !== null, track.capped]),
      [
        [1, true, false],
        [2, true, true],
        [3, false, false],
      ],
    );
  });

  test('reads a blob that names no file, track_num or is_capped', () => {
    const tracks = readTralbumTracks({
      trackinfo: [
        { id: 55501122, title: 'Low Tide', duration: 314.52, streaming: 1 },
        { id: 55501123, title: 'Harbour Lights', duration: 421.08, streaming: 1 },
        { id: 55501124, title: 'Breakwater', duration: 288.0 },
      ],
    });
    assert.deepEqual(tracks.map((track) => track.trackNum), [1, 2, 3]);
    assert.deepEqual(tracks.map((track) => track.streamUrl), [null, null, null]);
    assert.deepEqual(tracks.map((track) => track.capped), [false, false, false]);
    assert.equal(tracks[1]?.title, 'Harbour Lights');
  });

  test('refuses to stream an entry that says streaming but carries no file', () => {
    assert.equal(readTralbumTracks({ trackinfo: [{ id: 1, title: 'Pre-order only', streaming: 1, duration: 200 }] })[0]?.streamUrl, null);
  });

  test('refuses to stream an entry whose file is there but whose streaming flag is not', () => {
    assert.equal(readTralbumTracks({ trackinfo: [{ id: 1, streaming: 0, file: { 'mp3-128': streamUrl(1) } }] })[0]?.streamUrl, null);
  });

  test('names a Track by its position when the blob names it not at all', () => {
    assert.deepEqual(
      readTralbumTracks({ trackinfo: [{ id: 7 }, { id: 8, title: '' }] }).map((track) => track.title),
      ['Track 1', 'Track 2'],
    );
  });

  test('puts the tracklist in track order whatever order the array was in', () => {
    const tralbum = { trackinfo: [{ id: 3, track_num: 3 }, { id: 1, track_num: 1 }, { id: 2, track_num: 2 }] };
    assert.deepEqual(readTralbumTracks(tralbum).map((track) => track.trackId), ['1', '2', '3']);
  });

  test('keeps a duration only when there is one', () => {
    const tralbum = { trackinfo: [{ id: 1, duration: 0 }, { id: 2 }, { id: 3, duration: '314.52' }] };
    assert.deepEqual(readTralbumTracks(tralbum).map((track) => track.duration), [0, null, null]);
  });

  test('takes a track id that arrived as a string, and drops one that makes no sense', () => {
    const tralbum = { trackinfo: [{ id: '9007199254740993' }, { id: null }, { id: 'not-an-id' }, { id: 42 }] };
    assert.deepEqual(readTralbumTracks(tralbum).map((track) => track.trackId), ['9007199254740993', '42']);
  });

  test('skips a malformed entry and keeps the Tracks around it', () => {
    const tralbum = { trackinfo: [{ id: 1, track_num: 1 }, null, 'nonsense', 42, { id: 2, track_num: 2 }] };
    assert.deepEqual(readTralbumTracks(tralbum).map((track) => track.trackId), ['1', '2']);
  });

  test('answers with an empty tracklist for anything that is not a blob', () => {
    for (const value of [undefined, null, '', 42, [], { trackinfo: null }, { trackinfo: {} }]) {
      assert.deepEqual(readTralbumTracks(value), [], JSON.stringify(value));
    }
  });
});

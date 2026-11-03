/// <reference types="node" />
/**
 * The never-send list against the wire (ADR-0021): one sample of every Tally goes through the outbox and
 * out as a batch body, and nothing in it can name a Fan, a Release, a URL, a cookie or an id.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { openTestStore } from '../../test/nodeDb';
import { CATALOGUE, TALLY_NAMES, type Tally } from './catalogue';
import { buildErrorReport } from './errorReport';
import { enqueueErrorSync, enqueueTally, takeBatch, turnSharingOn } from './outbox';
import { batchBody } from './wire';

const NOW = Date.UTC(2026, 8, 29, 12, 0, 0);
const INSTALL = '3b9f0c52-8a0e-4c2f-9a41-6f1d2b7e9c10';
const CTX = { schema: 2, version: '1.0.0', build: '37', update: 'embedded', env: 'production', platform: 'ios', os: 26, channel: 'production' } as const;

/** Each property at every one of its allowed values, spread over as many samples as the longest set needs. */
function samples(): Tally[] {
  return TALLY_NAMES.flatMap((name) => {
    const props = Object.entries(CATALOGUE[name].props) as [string, readonly (string | boolean)[]][];
    const widest = Math.max(1, ...props.map(([, values]) => values.length));
    return Array.from({ length: widest }, (_, i) => ({
      name,
      props: Object.fromEntries(props.map(([key, values]) => [key, values[i % values.length]])),
    }) as Tally);
  });
}

const FORBIDDEN = [
  /https?:|www\.|\/\//i,
  /cookie|crumb_value|session/i,
  /(^|_)(fan_?id|user|username|name|url|avatar|id)(_|$)/i,
  /\d{5,}/,
  /[0-9a-f]{8}-[0-9a-f]{4}/i,
  /@/,
];

test('no Tally key or value on the wire names a Fan, a Release, a URL, a cookie or an id', async () => {
  const { db } = await openTestStore();
  await turnSharingOn(db, INSTALL, NOW);
  const all = samples();
  for (const tally of all) await enqueueTally(db, tally, { t: NOW, signedIn: true, walkDone: true });

  const seen: string[] = [];
  for (let taken = await takeBatch(db, () => crypto.randomUUID(), NOW); taken !== null; taken = await takeBatch(db, () => crypto.randomUUID(), NOW)) {
    const body = JSON.parse(JSON.stringify(batchBody({ key: 'wf_prod_x', install: INSTALL, batch: taken.batch, sentAt: NOW, ctx: CTX }, taken.rows)));
    assert.deepEqual(Object.keys(body), ['v', 'key', 'install', 'batch', 'sent_at', 'ctx', 'tallies', 'errors']);
    assert.deepEqual(Object.keys(body.ctx).sort(), ['build', 'channel', 'env', 'os', 'platform', 'schema', 'update', 'version']);
    for (const tuple of body.tallies as unknown[][]) {
      assert.equal(tuple.length, 4);
      const [t, name, flags, props] = tuple as [unknown, string, unknown, Record<string, unknown>];
      assert.equal(t, NOW);
      assert.equal(flags, 3);
      seen.push(name);
      for (const [key, value] of Object.entries(props)) {
        for (const text of [key, String(value)]) {
          for (const pattern of FORBIDDEN) assert.doesNotMatch(text, pattern, `${name}.${key}`);
        }
      }
    }
    await db.runAsync('delete from tally_outbox where batch = ?', [taken.batch]);
  }
  assert.equal(seen.length, all.length);
  assert.deepEqual([...new Set(seen)].sort(), [...TALLY_NAMES].sort());
});

test('an Error Report on the wire carries no name, URL, path, address or id from the thrown error', async () => {
  const { db } = await openTestStore();
  await turnSharingOn(db, INSTALL, NOW);
  const error = new TypeError(
    `no feed for "diggerfan" (fan 2214537) at https://bandcamp.com/diggerfan, vortex.bandcamp.com and ` +
      `/Users/me/Library/wavfeed.db from 192.168.1.23, mail ellie@nieuwdorp.me, token 3b9f0c52-8a0e-4c2f-9a41-6f1d2b7e9c10`,
  );
  error.stack = [
    '    at loadAndStart (http://100.72.58.62:8081/index.bundle?platform=ios:4821:17)',
    '    at p (address at /var/mobile/Containers/Data/Application/5F1C2E0A-1111-4C2B-9E0F-3A6D2B7E9C10/a1b2.hbc:1:132161)',
  ].join('\n');
  enqueueErrorSync(db, { errorsWritten: 0 }, buildErrorReport(error, { t: NOW, source: 'global', fatal: true, screen: 'feed' }));

  const taken = await takeBatch(db, () => crypto.randomUUID(), NOW);
  assert.ok(taken !== null);
  const body = batchBody({ key: 'wf_prod_x', install: INSTALL, batch: taken.batch, sentAt: NOW, ctx: CTX }, taken.rows);
  const [sent] = body.errors;
  const text = JSON.stringify([sent?.name, sent?.message, sent?.frames.map(([fn, file]) => [fn, file])]);
  for (const leak of [/diggerfan|vortex|ellie|bandcamp|Users|Containers/i, /\d{5,}/, /[0-9a-f]{8}-[0-9a-f]{4}/i, /@/, /\d+\.\d+\.\d+\.\d+/]) {
    assert.doesNotMatch(text, leak);
  }
  assert.deepEqual(sent?.frames.map((frame) => frame[1]), ['index.bundle', 'a1b2.hbc']);
});

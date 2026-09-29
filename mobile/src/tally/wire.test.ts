/// <reference types="node" />
/**
 * The never-send list against the wire (task 0038, ADR-0021): one sample of every Tally goes through the outbox and
 * out as a batch body, and nothing in it can name a Fan, a Release, a URL, a cookie or an id.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { openTestStore } from '../../test/nodeDb';
import { CATALOGUE, TALLY_NAMES, type Tally } from './catalogue';
import { enqueueTally, takeBatch, turnSharingOn } from './outbox';
import { batchBody } from './wire';

const NOW = Date.UTC(2026, 8, 29, 12, 0, 0);
const INSTALL = '3b9f0c52-8a0e-4c2f-9a41-6f1d2b7e9c10';
const CTX = { schema: 1, version: '1.0.0', build: '37', update: 'embedded', env: 'production', platform: 'ios', os: 26 } as const;

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
    assert.deepEqual(Object.keys(body.ctx).sort(), ['build', 'env', 'os', 'platform', 'schema', 'update', 'version']);
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

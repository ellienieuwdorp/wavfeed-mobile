/// <reference types="node" />
/** The development log reaches the console in a development bundle and never in a release one (review PRIV-2). */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { devLog } from './devLog';

const metro = globalThis as unknown as { __DEV__: boolean };

test('logs in a development bundle and stays silent in a release one', (t) => {
  const log = t.mock.method(console, 'log', () => undefined);
  t.after(() => {
    metro.__DEV__ = false;
  });

  metro.__DEV__ = false;
  devLog('fold:', 3, 'documents');
  assert.equal(log.mock.callCount(), 0);

  metro.__DEV__ = true;
  devLog('fold:', 3, 'documents');
  assert.deepEqual(
    log.mock.calls.map((call) => call.arguments),
    [['fold:', 3, 'documents']],
  );
});

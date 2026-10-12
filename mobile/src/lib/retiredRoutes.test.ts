/// <reference types="node" />
/** A link to Bought's retired routes opens New releases however it arrives, and every other link passes untouched (task 0071, decision 1). */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { redirectSystemPath } from './retiredRoutes';

const at = (path: string) => redirectSystemPath({ path, initial: true });

test('a link to Bought or its Upcoming list opens New releases, from Expo Go, the app scheme or a bare path', () => {
  const cases = [
    ['exp://localhost:8082/--/bought', 'exp://localhost:8082/--/releases'],
    ['exp://localhost:8082/--/bought/upcoming', 'exp://localhost:8082/--/releases'],
    ['wavfeed://bought', 'wavfeed://releases'],
    ['wavfeed:///bought/', 'wavfeed:///releases'],
    ['/bought?walk=1', '/releases?walk=1'],
  ] as const;
  for (const [path, opens] of cases) assert.equal(at(path), opens, path);
});

test('the Bought by sheet, other routes and the dev client launch link pass as they came', () => {
  for (const path of [
    'exp://localhost:8082/--/bought-by?fans=[]',
    'wavfeed://releases/upcoming',
    'exp://localhost:8082',
    'wavfeed://expo-development-client/?url=http%3A%2F%2Flocalhost%3A8082',
    '/player?sample=1',
    '/boughtish',
  ]) {
    assert.equal(at(path), path);
  }
});

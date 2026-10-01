/// <reference types="node" />
/** An accessibility setting as one store for the app. */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { liveSetting } from './a11y';

function native() {
  const calls = { reads: 0, listens: 0 };
  let answer: (on: boolean) => void = () => undefined;
  let change: (on: boolean) => void = () => undefined;
  const setting = liveSetting(
    () => {
      calls.reads += 1;
      return new Promise<boolean>((resolve) => (answer = resolve));
    },
    (set) => {
      calls.listens += 1;
      change = set;
    },
  );
  return { setting, calls, answer: (on: boolean) => answer(on), change: (on: boolean) => change(on) };
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

test('a hundred subscribers share one native read and one listener, and each hears a change', async () => {
  const { setting, calls, answer, change } = native();
  let heard = 0;
  const off = Array.from({ length: 100 }, () => setting.subscribe(() => (heard += 1)));
  assert.deepEqual(calls, { reads: 1, listens: 1 });
  assert.equal(setting.get(), null);
  answer(true);
  await settle();
  assert.equal(setting.get(), true);
  assert.equal(heard, 100);
  off[0]?.();
  change(false);
  assert.equal(setting.get(), false);
  assert.equal(heard, 199);
  setting.subscribe(() => undefined);
  assert.deepEqual(calls, { reads: 1, listens: 1 });
});

test('a change heard before the read answers wins over the read', async () => {
  const { setting, answer, change } = native();
  setting.subscribe(() => undefined);
  change(true);
  answer(false);
  await settle();
  assert.equal(setting.get(), true);
});

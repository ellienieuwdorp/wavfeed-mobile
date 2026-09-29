/// <reference types="node" />
/**
 * Hermes returns an Invalid Date for Bandcamp's "18 Aug 2026 07:28:27 GMT", where Node's V8 reads it, so these run with
 * string parsing taken out of `Date`: whatever reads here is read by hand, as it must be on the phone.
 */
import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';

import { parseWireDate } from './wire';

const EngineDate = globalThis.Date;

beforeEach(() => {
  globalThis.Date = class extends EngineDate {
    constructor(...args: ConstructorParameters<DateConstructor> | []) {
      if (args.length === 1 && typeof args[0] === 'string') super(Number.NaN);
      else super(...(args as ConstructorParameters<DateConstructor>));
    }
  } as DateConstructor;
});

afterEach(() => {
  globalThis.Date = EngineDate;
});

test('reads the wire date forms by hand', () => {
  const cases: readonly [string, number][] = [
    ['18 Aug 2026 07:28:27 GMT', EngineDate.UTC(2026, 7, 18, 7, 28, 27)],
    ['05 Aug 2026 00:00:00 GMT', EngineDate.UTC(2026, 7, 5)],
    ['Tue, 1 Sep 2026 23:59:59 GMT', EngineDate.UTC(2026, 8, 1, 23, 59, 59)],
    ['14 dec 2025', EngineDate.UTC(2025, 11, 14)],
  ];
  for (const [text, expected] of cases) assert.equal(parseWireDate(text)?.getTime(), expected, text);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  months.forEach((name, month) => assert.equal(parseWireDate(`15 ${name} 2026`)?.getTime(), EngineDate.UTC(2026, month, 15), name));
});

test('answers undefined for what it cannot read', () => {
  for (const text of ['', '18 Foo 2026 07:28:27 GMT', 'soon', '20260805']) assert.equal(parseWireDate(text), undefined, text);
});

/// <reference types="node" />
/**
 * Error Reports (task 0038, ADR-0021): the scrubber the phone and the Worker both run, Hermes stacks parsed to
 * basename frames, and a fingerprint source that ignores what changes with every build.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { WIRE } from './catalogue';
import { buildErrorReport, fingerprintSource, parseHermesStack, scrubMessage } from './errorReport';

/** A release build's stack as Hermes prints it, from an OTA update whose path names the app container. */
const HERMES_STACK = [
  "TypeError: Cannot read property 'title' of undefined",
  '    at p (address at /var/mobile/Containers/Data/Application/5F1C2E0A-1111-4C2B-9E0F-3A6D2B7E9C10/.expo-internal/a1b2.hbc:1:132161)',
  '    at anonymous (address at main.jsbundle:1:131119)',
  '    at forEach (native)',
  '    at loadAndStart (http://localhost:8081/index.bundle?platform=ios&dev=true:4821:17)',
  '    ... skipping 3 frames',
  '    at App',
].join('\n');

describe('the scrubber', () => {
  test('takes out URLs, quoted strings and digit runs longer than four', () => {
    assert.equal(
      scrubMessage('fetch https://bandcamp.com/ellie/feed?older_than=1727531042 failed for "diggerfan" on item 4102938475'),
      'fetch <url> failed for <str> on item <n>',
    );
    assert.equal(scrubMessage("Cannot read property 'title' of undefined"), 'Cannot read property <str> of undefined');
    assert.equal(scrubMessage('see www.example.com/x and `id` 1234 then 12345'), 'see <url> and <str> 1234 then <n>');
  });

  test('cuts to 200 characters and gives the same answer when run again, as the Worker does', () => {
    const long = `${'a'.repeat(150)} "x" ${'b'.repeat(150)}`;
    const once = scrubMessage(long);
    assert.equal(once.length, WIRE.maxMessage);
    for (const text of [long, 'item 4102938475 at https://x.bandcamp.com/album/y', "it's 'quoted'"]) {
      assert.equal(scrubMessage(scrubMessage(text)), scrubMessage(text));
    }
  });
});

describe('the Hermes stack parser', () => {
  test('keeps frames with file basenames only and leaves out skipped and component lines', () => {
    assert.deepEqual(parseHermesStack(HERMES_STACK), [
      ['p', 'a1b2.hbc', 1, 132161],
      ['anonymous', 'main.jsbundle', 1, 131119],
      ['forEach', 'native', 0, 0],
      ['loadAndStart', 'index.bundle', 4821, 17],
    ]);
  });

  test('keeps at most 50 frames', () => {
    const deep = Array.from({ length: 80 }, (_, i) => `    at f${i} (address at main.jsbundle:1:${i})`).join('\n');
    assert.equal(parseHermesStack(deep).length, WIRE.maxFrames);
  });
});

describe('buildErrorReport', () => {
  const at = { t: 1790675380002, source: 'promise', fatal: false, screen: 'player' } as const;

  test('reports a thrown Error by name, scrubbed message and parsed frames', () => {
    const error = new TypeError("Cannot read property 'title' of undefined");
    error.stack = HERMES_STACK;
    const report = buildErrorReport(error, at);
    assert.deepEqual({ ...report, frames: report.frames.length }, {
      t: at.t, source: 'promise', fatal: false, code: null, name: 'TypeError',
      message: 'Cannot read property <str> of undefined', screen: 'player', frames: 4,
    });
  });

  test('a thrown value that is not an Error keeps only its scrubbed text', () => {
    const report = buildErrorReport('lost https://bandcamp.com/diggerfan', { ...at, source: 'code', code: 'fold_failed' });
    assert.equal(report.name, 'NonError');
    assert.equal(report.message, 'lost <url>');
    assert.equal(report.code, 'fold_failed');
    assert.deepEqual(report.frames, []);
  });

  test('an error name outside the Worker pattern is cleaned to fit it', () => {
    const error = new Error('x');
    error.name = 'Bad Name <script> '.repeat(10);
    assert.match(buildErrorReport(error, at).name, WIRE.errorNamePattern);
  });
});

test('the fingerprint source ignores frame offsets, which change with every build, and keeps the screen', () => {
  const error = new TypeError('undefined is not a function');
  error.stack = '    at p (address at main.jsbundle:1:132161)';
  const build37 = buildErrorReport(error, { t: 1, source: 'global', fatal: true, screen: 'feed' });
  error.stack = '    at q (address at main.jsbundle:1:99001)';
  const build38 = buildErrorReport(error, { t: 2, source: 'global', fatal: true, screen: 'feed' });
  assert.equal(fingerprintSource(build37), fingerprintSource(build38));
  assert.notEqual(fingerprintSource(build37), fingerprintSource({ ...build37, screen: 'player' }));
});

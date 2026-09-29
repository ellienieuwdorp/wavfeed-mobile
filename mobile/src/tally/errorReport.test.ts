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

  test('takes out emails, hosts without a scheme, file paths, ids and IP addresses', () => {
    const cases: [string, string][] = [
      ['mail ellie@nieuwdorp.me failed', 'mail <email> failed'],
      ['no page at diggerfan.bandcamp.com', 'no page at <url>'],
      ['art f4.bcbits.com/img/a1.jpg gone', 'art <url> gone'],
      ['open vortex.example/album/x', 'open <url>'],
      ['cannot open /Users/me/Library/wavfeed.db', 'cannot open <path>'],
      ['at /data/user/0/com.wavfeed.app/files/x.db: locked', 'at <path> locked'],
      ['container 5F1C2E0A-1111-4C2B-9E0F-3A6D2B7E9C10 gone', 'container <id> gone'],
      ['hash 9f86d081884c7d659a2feaa0c55ad015 differs', 'hash <id> differs'],
      ['no route to 192.168.1.23 on 100.72.58.62', 'no route to <ip> on <ip>'],
      ['undefined is not an object', 'undefined is not an object'],
    ];
    for (const [text, scrubbed] of cases) assert.equal(scrubMessage(text), scrubbed, text);
  });

  test('a quoted string over several lines goes too', () => {
    assert.equal(scrubMessage('parse "diggerfan\nvortex" failed'), 'parse <str> failed');
  });

  test('cuts to 200 characters and gives the same answer when run again, as the Worker does', () => {
    const long = `${'a'.repeat(150)} "x" ${'b'.repeat(150)}`;
    const once = scrubMessage(long);
    assert.equal(once.length, WIRE.maxMessage);
    const cases = [
      long,
      `${'a'.repeat(199)} b`,
      'item 4102938475 at https://x.bandcamp.com/album/y',
      "it's 'quoted'",
      "line 'a\nb' end",
      'ellie@nieuwdorp.me at /Users/me/x on 10.0.2.2 as 5F1C2E0A-1111-4C2B-9E0F-3A6D2B7E9C10',
    ];
    for (const text of cases) assert.equal(scrubMessage(scrubMessage(text)), scrubMessage(text), text);
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

  test('keeps function and file names to ASCII without long digit runs', () => {
    const [frame] = parseHermesStack('    at get 4102938475 ✓ (address at /Users/me/müsic.bundle:1:9)');
    assert.deepEqual(frame, ['get', 'msic.bundle', 1, 9]);
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

  test('a thrown value whose getters throw or that has no string form still makes a report', () => {
    const hostile = new Error('x');
    Object.defineProperty(hostile, 'message', { get: () => { throw new Error('no'); } });
    Object.defineProperty(hostile, 'stack', { get: () => { throw new Error('no'); } });
    assert.deepEqual(
      [buildErrorReport(hostile, at).message, buildErrorReport(hostile, at).frames],
      ['', []],
    );
    assert.equal(buildErrorReport(Object.create(null), at).message, '');
    assert.equal(buildErrorReport(Symbol('s'), at).message, 'Symbol(s)');
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

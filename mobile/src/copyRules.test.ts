/// <reference types="node" />
/**
 * The copy rules DESIGN-UI section 8 and the sharing copy's rules make testable: no em dash anywhere
 * in the phone's copy, the sharing strings never use the machine words (the author chose "usage statistics", "crash
 * reports" and "login" for the Settings line) and name no Bandcamp identity, and every line under a Settings group or on
 * the first screen is two sentences at most.
 */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { codeSentence, copy } from './copy';

const CODE = '3b9f0c';

test('no copy file holds an em dash', () => {
  const files = readdirSync(import.meta.dirname, { recursive: true, encoding: 'utf8' }).filter((f) => /(^|\/)copy\.ts$/.test(f));
  assert.ok(files.length >= 3, files.join(', '));
  for (const file of files) {
    const text = readFileSync(join(import.meta.dirname, file), 'utf8');
    assert.ok(!text.includes('—'), file);
  }
});

test('the ask and the Usage group never say telemetry, event or tracking, and the code shows in its own lines, never in the foot', () => {
  const s = copy.settings;
  const yourCode = codeSentence(s.yourCode, CODE);
  const turnedOff = codeSentence(s.turnedOff, CODE);
  const strings = [
    copy.usageAsk.title,
    ...copy.usageAsk.body,
    copy.usageAsk.link,
    copy.usageAsk.yes,
    copy.usageAsk.no,
    s.usageHead,
    s.share,
    s.usageFoot,
    yourCode,
    turnedOff,
    s.turnOffFailed,
    s.copyCode,
    s.copied,
    s.privacy,
    s.feedback,
    s.feedbackBody({ version: '1.0.0', build: '37', os: 'iOS 26', code: CODE }),
  ];
  for (const text of strings) {
    assert.doesNotMatch(text, /telemetr|event|tracking|—/i, text);
  }
  assert.match(copy.usageAsk.body.join(' '), /counts/i);
  assert.match(copy.usageAsk.body.join(' '), /Until then it sends nothing/);
  assert.match(copy.usageAsk.body.join(' '), /Settings/);
  assert.match(s.usageFoot, /Does not send your Bandcamp login/);
  assert.doesNotMatch(s.usageFoot, /3b9f0c/);
  assert.match(yourCode, /^Your code is 3b9f0c, /);
  assert.match(turnedOff, /Your code was 3b9f0c; .*delete/);
});

test('every line under a Settings group or on the first screen is two sentences at most', () => {
  const s = copy.settings;
  const lines = [
    s.custody,
    s.notGathering,
    s.removeAllBody(true),
    s.removeAllBody(false),
    s.usageFoot,
    codeSentence(s.turnedOff, CODE),
    s.turnOffFailed,
    s.signOutUnreachable,
    copy.demo.foot,
    copy.demo.statusSub,
    copy.welcome.title,
    copy.welcome.sub,
    copy.welcome.custody,
    copy.welcome.demoFailed,
    ...copy.usageAsk.body,
  ];
  for (const text of lines) {
    const sentences = (text.match(/[.?!](?=\s|$)/g) ?? []).length;
    assert.ok(sentences <= 2, `${sentences} sentences: ${text}`);
    assert.ok(text.length <= 160, `${text.length} characters: ${text}`);
  }
  // The code's sentence follows the foot while sharing is on, one sentence of its own.
  const yourCode = codeSentence(s.yourCode, CODE);
  assert.equal((yourCode.match(/[.?!](?=\s|$)/g) ?? []).length, 1, yourCode);
});

test('the first screen and Settings keep the facts that matter for trust, in the house words', () => {
  const s = copy.settings;
  for (const text of [copy.welcome.custody, s.custody]) assert.match(text, /Bandcamp sign-in stays on this (iPhone|phone)/, text);
  assert.match(copy.welcome.sub, /pages you follow/);
  assert.doesNotMatch(copy.welcome.sub, /labels you follow/);
  assert.match(copy.demo.foot, /sample/);
  for (const text of [copy.welcome.title, copy.welcome.sub, copy.welcome.custody, copy.welcome.demoFailed, copy.demo.foot]) {
    assert.doesNotMatch(text, /demo|user|sync|scrap|crawl|—/i, text);
  }
});

test('a feedback mail carries the build and the code only when there is one', () => {
  const s = copy.settings;
  assert.equal(s.feedbackBody({ version: '1.0.0', build: '37', os: 'iOS 26', code: null }), '\n\nVersion 1.0.0 (37) · iOS 26');
  assert.equal(s.feedbackBody({ version: '1.0.0', build: '37', os: 'Android 16', code: CODE }), '\n\nVersion 1.0.0 (37) · Android 16 · code 3b9f0c');
});

test('the failure screens speak without machine words, and the store mail names its code, cause and build', () => {
  const f = copy.failed;
  const screens = [f.screenTitle, f.screenBody, f.appTitle, f.appBody, f.tryAgain, f.storeTitle, f.storeBody, f.sendReport, f.reportSubject];
  const startOver = [f.startOver, f.startOverTitle, f.startOverBody, f.startOverConfirm, f.startOverFailed, f.cancel];
  for (const text of [...screens, ...startOver]) {
    assert.doesNotMatch(text, /error|crash|exception|database|store|—/i, text);
  }
  // A failure that repeats on every open is not helped by a restart (review REL-4).
  assert.doesNotMatch(f.storeBody, /restart|usually helps/i);
  const facts = { version: '1.0.0', build: '37', os: 'Android 16', code: null };
  assert.equal(f.reportBody(facts, null), '\n\nstore_open_failed · Version 1.0.0 (37) · Android 16');
  assert.equal(
    f.reportBody(facts, { name: 'Error', message: 'no such column: <str>' }),
    '\n\nstore_open_failed · Error: no such column: <str> · Version 1.0.0 (37) · Android 16',
  );
});

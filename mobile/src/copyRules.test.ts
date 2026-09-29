/// <reference types="node" />
/**
 * The copy rules DESIGN-UI section 8 and task 0038 decision 4 make testable: no em dash anywhere in the phone's copy,
 * and the sharing strings say "counts", never the machine words, and name no Bandcamp identity.
 */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { copy } from './copy';

test('no copy file holds an em dash', () => {
  const files = readdirSync(import.meta.dirname, { recursive: true, encoding: 'utf8' }).filter((f) => /(^|\/)copy\.ts$/.test(f));
  assert.ok(files.length >= 3, files.join(', '));
  for (const file of files) {
    const text = readFileSync(join(import.meta.dirname, file), 'utf8');
    assert.ok(!text.includes('—'), file);
  }
});

test('the ask and the Usage group say counts, never analytics, telemetry or event', () => {
  const s = copy.settings;
  const strings = [
    copy.usageAsk.title,
    ...copy.usageAsk.body,
    copy.usageAsk.yes,
    copy.usageAsk.notNow,
    s.usageHead,
    s.share,
    s.usageFoot(null),
    s.usageFoot('3b9f0c'),
    s.turnedOff('3b9f0c'),
    s.privacy,
    s.feedback,
    s.feedbackBody({ version: '1.0.0', build: '37', os: 'iOS 26', code: '3b9f0c' }),
  ];
  for (const text of strings) {
    assert.doesNotMatch(text, /analytic|telemetr|event|tracking|—/i, text);
  }
  assert.match(copy.usageAsk.body.join(' '), /counts/);
  assert.match(s.usageFoot('3b9f0c'), /Your code is 3b9f0c\./);
});

test('a feedback mail carries the build and the code only when there is one', () => {
  const s = copy.settings;
  assert.equal(s.feedbackBody({ version: '1.0.0', build: '37', os: 'iOS 26', code: null }), '\n\nVersion 1.0.0 (37) · iOS 26');
  assert.equal(s.feedbackBody({ version: '1.0.0', build: '37', os: 'Android 16', code: '3b9f0c' }), '\n\nVersion 1.0.0 (37) · Android 16 · code 3b9f0c');
});

test('the failure screens speak without machine words, and the store mail names its code and build', () => {
  const f = copy.failed;
  for (const text of [f.screenTitle, f.screenBody, f.appTitle, f.appBody, f.tryAgain, f.storeTitle, f.storeBody, f.sendReport, f.reportSubject]) {
    assert.doesNotMatch(text, /error|crash|exception|database|store|—/i, text);
  }
  assert.equal(f.reportBody({ version: '1.0.0', build: '37', os: 'Android 16', code: null }), '\n\nstore_open_failed · Version 1.0.0 (37) · Android 16');
});

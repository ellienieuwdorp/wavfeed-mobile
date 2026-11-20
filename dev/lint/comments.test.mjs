// Each comment rule fires on the case it names and not on its near neighbour.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { checkFile, checkSources, LIMITS } from './comments.mjs';

const rules = (src, file = 'mobile/src/x.ts') => checkFile(file, src).problems.map((p) => p.rule);
const code = (n) => Array.from({ length: n }, (_, i) => `export const v${i} = ${i};`).join('\n');
const header = '/** The x module: what it does, in one line (ADR-0004). */\n';
const lines = (n, text = 'line') => Array.from({ length: n }, () => ` * ${text}`).join('\n');

test('history goes; the present tense, and "no longer" about runtime state, stays', () => {
  assert.deepEqual(rules(`${header}// Ported from packages/core.\n${code(3)}`), ['history']);
  assert.deepEqual(rules(`${header}// The store used to read one wide join.\n${code(3)}`), ['history']);
  assert.deepEqual(rules(`${header}// The cursor was renamed when the walk split.\n${code(3)}`), ['history']);
  assert.deepEqual(rules(`${header}// Previously the turn folded once.\n${code(3)}`), ['history']);
  assert.deepEqual(rules(`${header}// A Release the store no longer holds reads as gone.\n${code(3)}`), []);
  assert.deepEqual(rules(`${header}// The key used to sort the rows.\n${code(3)}`), []);
});

test('a banner or separator goes', () => {
  assert.deepEqual(rules(`${header}// ---------- Section ----------\n${code(3)}`), ['banner']);
  assert.deepEqual(rules(`${header}// =====\n${code(3)}`), ['banner']);
  assert.deepEqual(rules(`${header}/* ***** */\n${code(3)}`), ['banner']);
  assert.deepEqual(rules(`${header}// #region parsing\n${code(3)}`), ['banner']);
  assert.deepEqual(rules(`${header}// A range, 1-3, and a flag -- set.\n${code(3)}`), []);
});

test('commented-out code goes, prose that mentions code stays', () => {
  assert.deepEqual(rules(`${header}// const a = foo(1);\n${code(3)}`), ['commentedCode']);
  assert.deepEqual(rules(`${header}// return null;\n${code(3)}`), ['commentedCode']);
  assert.deepEqual(rules(`${header}// await fold(db);\n${code(3)}`), ['commentedCode']);
  assert.deepEqual(rules(`${header}// if (done) {\n//   stop();\n// }\n${code(3)}`).filter((r) => r === 'commentedCode').length > 0, true);
  assert.deepEqual(rules(`${header}// The store reads one wide join; then it folds.\n${code(3)}`), []);
  assert.deepEqual(rules(`${header}// Call fold(db) after each batch (ADR-0004).\n${code(3)}`), []);
  assert.deepEqual(rules(`${header}// if the cursor moves, the walk resumes.\n${code(3)}`), []);
});

test('an em dash and a suppression without its reason are each named', () => {
  assert.deepEqual(rules(`${header}// One pass — then stop.\n${code(3)}`), ['emDash']);
  assert.deepEqual(rules(`${header}// oxlint-disable-next-line no-console\n${code(3)}`), ['suppression']);
  assert.deepEqual(rules(`${header}/* eslint-disable */\n${code(3)}`), ['suppression']);
  assert.deepEqual(rules(`${header}// oxlint-disable-next-line no-console -- the one home of the dev log\n${code(3)}`), []);
});

test(`a module header is one paragraph of at most ${LIMITS.headerLines} lines`, () => {
  assert.deepEqual(rules(`/**\n * What it does.\n *\n * Why, at length (ADR-0004).\n */\n${code(3)}`), ['headerParagraphs']);
  assert.deepEqual(rules(`// What it does.\n//\n// Why, at length.\n${code(3)}`), ['headerParagraphs']);
  assert.deepEqual(rules(`/**\n${lines(LIMITS.headerLines + 1)}\n */\n${code(3)}`), ['headerLong']);
  assert.deepEqual(rules(`/**\n${lines(LIMITS.headerLines)}\n */\n${code(3)}`), []);
  assert.deepEqual(rules(`#!/usr/bin/env node\n${header}${code(3)}`, 'mobile/scripts/x.mjs'), []);
});

test(`a JSDoc past ${LIMITS.docLines} lines is long`, () => {
  assert.deepEqual(rules(`${header}/**\n${lines(LIMITS.docLines + 1)}\n */\nexport function f() {}\n`), ['docLong']);
  assert.deepEqual(rules(`${header}/**\n${lines(LIMITS.docLines)}\n */\nexport function f() {}\n`), []);
});

test('directives count toward no share; the share counts source, not tests', () => {
  const noted = (comment) => Array.from({ length: 10 }, (_, i) => `// ${comment} ${i}\nexport const v${i} = ${i};`).join('\n');
  const share = (file, src) => checkSources('mobile', [{ file, src }]);
  assert.deepEqual(share('mobile/src/x.ts', `${header}${noted('note')}`).problems.map((p) => p.rule), ['share']);
  assert.deepEqual(share('mobile/src/x.ts', `${header}${noted('oxlint-disable-next-line no-console -- why')}`).problems, []);
  assert.deepEqual(share('mobile/src/x.test.ts', `${header}${noted('note')}`).problems, []);
});

// Each budget fires on the case it names and not on its near neighbour.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { BUDGETS, checkSources } from './budgets.mjs';

const source = (n) => Array.from({ length: n }, (_, i) => `export const v${i} = ${i};`).join('\n');
const problems = (...sources) => checkSources('mobile', sources.map(([file, src]) => ({ file, src }))).problems;
const body = 'return Math.max(0, Math.round(seconds * 1000) - Date.now() + offsetMs);';

test(`a test file past ${BUDGETS.testFileLines} lines is over`, () => {
  const big = source(2000);
  assert.equal(problems(['mobile/src/a.ts', big], ['mobile/src/a.test.ts', source(BUDGETS.testFileLines + 1)]).length, 1);
  assert.deepEqual(problems(['mobile/src/a.ts', big], ['mobile/src/a.test.ts', source(BUDGETS.testFileLines)]), []);
});

test(`tests past ${BUDGETS.testToSource} lines per source line are over`, () => {
  assert.match(problems(['mobile/src/a.ts', source(100)], ['mobile/test/a.ts', source(61)])[0] ?? '', /61 test lines for 100/);
  assert.deepEqual(problems(['mobile/src/a.ts', source(100)], ['mobile/test/a.ts', source(60)]), []);
});

test('a grab-bag module name is refused, in a file or a folder', () => {
  for (const file of ['mobile/src/utils.ts', 'mobile/src/lib/helpers.ts', 'mobile/src/common/time.ts', 'mobile/test/shared.ts', 'mobile/src/misc.tsx'])
    assert.match(problems(['mobile/src/a.ts', source(10)], [file, source(1)])[0] ?? '', /grab-bag/, file);
  assert.deepEqual(problems(['mobile/src/utilization.ts', source(1)], ['mobile/src/commonplace.ts', source(1)]), []);
});

test('the same function body in two modules is one helper with two homes', () => {
  const fn = (name) => `export function ${name}(seconds: number, offsetMs: number) {\n  ${body}\n}\n`;
  const arrow = (name) => `export const ${name} = (seconds: number, offsetMs: number) => {\n  ${body}\n};\n`;
  assert.match(problems(['mobile/src/a.ts', fn('wait')], ['mobile/src/b.ts', arrow('delay')])[0] ?? '', /a\.ts, mobile\/src\/b\.ts: the same function body/);
  assert.deepEqual(problems(['mobile/src/a.ts', fn('wait') + fn('again')]), []);
  assert.deepEqual(problems(['mobile/src/a.ts', 'export function f() {\n  return 1;\n}\n'], ['mobile/src/b.ts', 'export function g() {\n  return 1;\n}\n']), []);
});

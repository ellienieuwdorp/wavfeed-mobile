// Size and naming budgets over one project: no test file past a line cap, test lines within a ratio of source lines,
// no grab-bag module name, and no function body declared identically in two modules. Lines are non-blank lines.
// `node dev/lint/budgets.mjs <project>` prints each breach with its fix.
import { basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseSync } from 'oxc-parser';

import { projectArg, readSources, TEST } from './tree.mjs';

// Each ceiling sits just above the largest value on 2026-11-03, after mobile's turn and queries tests were
// split: tallies/test/ingest.test.ts at 466 lines, the highest project at 0.598 test lines per source line, no grab-bag
// name, no shared body. Lower a ceiling when the code allows; raise one only in a commit that says why.
export const BUDGETS = { testFileLines: 480, testToSource: 0.6, minBodyChars: 60 };
const GRAB_BAG = /^(utils?|helpers?|common|misc|shared)(\.|$)/;

const nonBlank = (src) => src.split('\n').filter((l) => l.trim()).length;

/** Top-level function bodies, comments and whitespace folded, long enough to be worth one home. */
function bodies(file, src) {
  const out = [];
  for (let node of parseSync(file, src).program.body) {
    if ((node.type === 'ExportNamedDeclaration' || node.type === 'ExportDefaultDeclaration') && node.declaration) node = node.declaration;
    const fns = node.type === 'FunctionDeclaration' ? [node] : node.type === 'VariableDeclaration' ? node.declarations.map((d) => d.init).filter((i) => /Function/.test(i?.type ?? '')) : [];
    for (const fn of fns) {
      if (!fn.body) continue;
      const text = src.slice(fn.body.start, fn.body.end).replace(/\/\/.*|\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ');
      if (text.length >= BUDGETS.minBodyChars) out.push(text);
    }
  }
  return out;
}

/** Every budget over a project's files, each `{ file, src }`. */
export function checkSources(project, sources) {
  const problems = [];
  let source = 0;
  let tests = 0;
  const homes = new Map();
  for (const { file, src } of sources) {
    const lines = nonBlank(src);
    if (GRAB_BAG.test(basename(file)) || file.split('/').slice(0, -1).some((d) => GRAB_BAG.test(d)))
      problems.push(`${file}: a grab-bag module name. Name the module for what it does, or move each helper next to its one caller.`);
    if (!TEST.test(file)) {
      source += lines;
      for (const body of bodies(file, src)) homes.set(body, [...(homes.get(body) ?? []), file]);
      continue;
    }
    tests += lines;
    if (lines > BUDGETS.testFileLines)
      problems.push(`${file}: ${lines} lines, over ${BUDGETS.testFileLines}. Split it by behaviour into files that share one setup module.`);
  }
  const ratio = tests / source;
  if (ratio > BUDGETS.testToSource)
    problems.push(`${project}: ${tests} test lines for ${source} source lines (${ratio.toFixed(2)}), over ${BUDGETS.testToSource}. Fold cases into tables and delete tests no bug could fail.`);
  for (const at of homes.values())
    if (new Set(at).size > 1) problems.push(`${[...new Set(at)].join(', ')}: the same function body twice. Keep one, export it, and import it in the other (one helper, one home).`);
  return { problems, ratio, tests, source };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const project = projectArg('budgets.mjs');
  const { problems, ratio } = checkSources(project, readSources(project));
  for (const p of problems) console.error(p);
  console.log(`${project}: ${ratio.toFixed(2)} test lines per source line`);
  if (problems.length) {
    console.error(`\n${problems.length} budget problem(s) in ${project}.`);
    process.exitCode = 1;
  }
}

// The comment rules of docs/V2-PLAN.md section 7 over one project, parsed with oxc-parser: the project's source stays
// under 15 percent comment lines, a module header is one short paragraph, a JSDoc stays short, and no comment carries
// history, a banner, commented-out code, an em dash or a lint suppression without its reason. `ceiling:` comments
// and directives count toward nothing. Task citations are dev/check-docs.mjs's rule, and `@ts-` comments are oxlint's
// typescript/ban-ts-comment. `node dev/lint/comments.mjs <project>` prints each problem with its fix.
import { pathToFileURL } from 'node:url';
import { parseSync } from 'oxc-parser';

import { projectArg, readSources, TEST } from './tree.mjs';

// ceiling: 8 header lines held 89 percent of headers before the 2026-11-03 cleanup and is the longest after it, 14
// headers at the cap; JSDoc 4 lines, 40 at the cap. Lower a cap in the commit that shortens what sits at it.
export const LIMITS = { share: 0.15, headerLines: 8, docLines: 4 };

const DIRECTIVE = /^[\s*]*(eslint-|oxlint-|@ts-|\/ <reference|[#@]__PURE__|prettier-ignore|c8 ignore|v8 ignore|istanbul ignore)/;
const CEILING = /^[\s*]*ceiling:/;
const UNEXPLAINED_SUPPRESSION = /^[\s*]*(eslint|oxlint)-disable(?![^\n]*\s--\s+\S)/;
const HISTORY =
  /\b(ported|copied|lifted|carried over|migrated) from\b|\b(it|this|that|which|we|they) used to\b|\bused to (be|have|read|call|live|hold)\b|\b(previously|formerly|originally)\b|\banymore\b|\b(was|were|has been|have been) (changed|renamed|moved|replaced|removed|dropped|deleted|split|merged|rewritten)\b/i;
const BANNER = /^[\s*/]*([-=*#~_\u2500\u2501\u2550]{3,}|#(end)?region\b)|[-=\u2500\u2501\u2550]{4,}\s*$/;
// A line of code ends in one of these or opens with a keyword; prose rarely does both and parses too.
const CODE_SHAPE = /[;{}]\s*$|^\s*(const|let|var|return|import|export|await|if|for|while|function|class|type|interface)\b.*[=({;]|^\s*[\w.$]+\(.*\);?\s*$/;
const EM_DASH = '\u2014';

export const FIXES = {
  share: `comment lines are at or over ${LIMITS.share * 100} percent of the project's source (V2-PLAN section 7). Delete comments that restate the code or argue a decision, and cite the ADR instead.`,
  headerParagraphs: 'the module header runs to a second paragraph. Keep one paragraph of mechanism; move the argument to its ADR and cite it by number.',
  headerLong: `the module header runs past ${LIMITS.headerLines} lines of text. Say what the module does and cite the ADR; the code and the ADR carry the rest.`,
  docLong: `this JSDoc runs past ${LIMITS.docLines} lines of text. State the contract the code cannot show; cut what restates the body.`,
  history: 'this comment tells history. Say what the code does now; git log keeps what it used to do.',
  banner: 'banner or separator comment. Delete it; split the module if it needs sections.',
  commentedCode: 'commented-out code. Delete it; git log keeps it.',
  emDash: 'em dash in a comment (house style). Use a colon, a semicolon or two sentences.',
  suppression: 'lint suppression without a reason. Write it as `oxlint-disable-next-line <rule> -- <why>`.',
};

const lineIndex = (src) => {
  const starts = [0];
  for (let i = 0; i < src.length; i++) if (src[i] === '\n') starts.push(i + 1);
  return (pos) => {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= pos) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  };
};

const textLines = (c) => (c.type === 'Line' ? [c.value] : c.value.split('\n').map((l) => l.replace(/^\s*\*+\/?/, '')));

/** Comment blocks: one block comment, or a run of `//` lines on consecutive lines; a ceiling starts its own. */
function blocks(comments, lineOf) {
  const out = [];
  for (const c of comments) {
    const first = lineOf(c.start);
    const last = lineOf(c.end);
    const prev = out.at(-1);
    if (c.type === 'Line' && prev?.type === 'Line' && prev.last === first - 1 && !CEILING.test(c.value)) {
      prev.last = last;
      prev.lines.push(c.value);
      prev.raw.push(c.value);
    } else out.push({ type: c.type, doc: c.type === 'Block' && c.value.startsWith('*'), first, last, start: c.start, lines: textLines(c), raw: c.value.split('\n') });
  }
  return out;
}

const parses = (code) => parseSync('x.ts', code).errors.length === 0;

/** A block's text lines from its first to its last that is not blank. */
const inner = (block) => {
  const text = block.lines.map((l) => l.trim());
  return text.slice(text.findIndex(Boolean), text.findLastIndex(Boolean) + 1);
};

/** Whether a comment line is code with its slashes on. */
const isCode = (line) => CODE_SHAPE.test(line) && (parses(line) || parses(`async function f() {\n${line}\n}`));

/** One file's problems, and its comment and non-blank line counts for the share. */
export function checkFile(file, src) {
  const lineOf = lineIndex(src);
  const problems = [];
  const at = (line, rule) => problems.push({ file, line, rule });
  const { program, comments } = parseSync(file, src);
  // oxc lists a hashbang among the comments.
  const own = comments.filter((c) => c.start !== program.hashbang?.start);
  for (const c of own) if (UNEXPLAINED_SUPPRESSION.test(c.value)) at(lineOf(c.start), 'suppression');
  const all = blocks(
    own.filter((c) => !DIRECTIVE.test(c.value)),
    lineOf,
  );
  const prose = all.filter((b) => !CEILING.test(b.lines[0]));
  const counted = new Set();
  for (const b of prose) {
    for (let l = b.first; l <= b.last; l++) counted.add(l);
    b.lines.forEach((text, i) => {
      const line = b.first + i;
      if (HISTORY.test(text)) at(line, 'history');
      if (BANNER.test(b.raw[i] ?? '')) at(line, 'banner');
      if (text.includes(EM_DASH)) at(line, 'emDash');
      if (isCode(text)) at(line, 'commentedCode');
    });
  }
  const firstStatement = program.body[0]?.start ?? src.length;
  const header = prose[0] && prose[0] === all[0] && prose[0].start < firstStatement ? prose[0] : null;
  if (header) {
    const text = inner(header);
    if (text.includes('')) at(header.first, 'headerParagraphs');
    if (text.length > LIMITS.headerLines) at(header.first, 'headerLong');
  }
  for (const b of prose) if (b !== header && b.doc && inner(b).length > LIMITS.docLines) at(b.first, 'docLong');
  return { problems, comment: counted.size, lines: src.split('\n').filter((l) => l.trim()).length };
}

/** Every rule over a project's files, each `{ file, src }`, with its source's comment share. */
export function checkSources(project, sources) {
  const problems = [];
  let comment = 0;
  let lines = 0;
  for (const { file, src } of sources) {
    const r = checkFile(file, src);
    problems.push(...r.problems);
    if (TEST.test(file)) continue;
    comment += r.comment;
    lines += r.lines;
  }
  const share = lines === 0 ? 0 : comment / lines;
  if (share >= LIMITS.share) problems.push({ file: project, line: 0, rule: 'share', note: `${comment} of ${lines} lines, ${(100 * share).toFixed(1)} percent` });
  return { problems, share };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const project = projectArg('comments.mjs');
  const { problems, share } = checkSources(project, readSources(project));
  for (const p of problems) console.error(`${p.file}:${p.line} ${p.rule}: ${FIXES[p.rule]}${p.note ? ` (${p.note})` : ''}`);
  console.log(`${project}: comments are ${(100 * share).toFixed(1)} percent of source lines`);
  if (problems.length) {
    console.error(`\n${problems.length} comment problem(s) in ${project}.`);
    process.exitCode = 1;
  }
}

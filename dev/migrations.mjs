#!/usr/bin/env node
// Refuses a migration number the base already holds for another migration, and two migrations sharing a number, since
// migrations are numbered in order of reaching main. `mobile` reads the versions in
// mobile/src/store/migrations.ts and compares each one's body with whitespace collapsed; `tallies` reads the files in
// tallies/migrations/ and compares names and contents. It compares the working tree with `git show <base>:<path>`:
// `node dev/migrations.mjs mobile|tallies [base]`, base origin/main by default.
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';

const [kind, base = 'origin/main'] = process.argv.slice(2);
const git = (...args) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });

/** Each migration as [number, what identifies it], in file order. */
function mobile(text) {
  const list = text.slice(text.indexOf('const MIGRATIONS'), text.indexOf('\n];', text.indexOf('const MIGRATIONS')));
  return [...list.matchAll(/^ {4}version: (\d+),$([\s\S]*?)^ {2}\},?$/gm)].map((m) => [Number(m[1]), m[2].replace(/\s+/g, ' ').trim()]);
}

function tallies(names, read) {
  return names.filter((name) => /^\d+_.*\.sql$/.test(name)).map((name) => [Number.parseInt(name, 10), `${name}\n${read(name)}`]);
}

let here;
let there;
let label;
if (kind === 'mobile') {
  const path = 'mobile/src/store/migrations.ts';
  label = path;
  here = mobile(readFileSync(path, 'utf8'));
  there = mobile(git('show', `${base}:${path}`));
} else if (kind === 'tallies') {
  const dir = 'tallies/migrations';
  label = `${dir}/`;
  here = tallies(readdirSync(dir), (name) => readFileSync(`${dir}/${name}`, 'utf8'));
  const names = git('ls-tree', '--name-only', `${base}:${dir}`).split('\n').filter(Boolean);
  there = tallies(names, (name) => git('show', `${base}:${dir}/${name}`));
} else {
  console.error('usage: node dev/migrations.mjs mobile|tallies [base]');
  process.exit(64);
}

const problems = [];
const seen = new Set();
for (const [n] of here) {
  if (seen.has(n)) problems.push(`two migrations here are numbered ${n}.`);
  seen.add(n);
}
const theirs = new Map(there);
const highest = Math.max(0, ...theirs.keys());
for (const [n, body] of here) {
  if (theirs.has(n) && theirs.get(n) !== body) {
    problems.push(`migration ${n} is not ${base}'s migration ${n}. A new one renumbers after ${highest}; a shipped one is never edited, so add a migration.`);
  }
}
if (problems.length > 0) {
  console.error(`${label}:\n${problems.map((p) => `  ${p}`).join('\n')}`);
  process.exit(1);
}
console.log(`${label}: ${here.length} migrations, none taking a number ${base} gave another (its highest is ${highest}).`);

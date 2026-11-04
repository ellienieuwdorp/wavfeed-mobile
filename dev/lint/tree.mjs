// The tracked files of a project that comments.mjs and budgets.mjs read: source and test code, without generated
// output, declaration files and tool configs. A test file is a `*.test.*` file or anything under `test/` or
// `__checks__/`; everything else is source.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

// A checkout without one of them reads it as empty; dev/check.sh skips a missing project.
export const PROJECTS = ['mobile', 'tallies', 'join'];
const CODE = /\.(tsx?|mjs|cjs|js)$/;
const SKIPPED = /(^|\/)(\.dry|\.wrangler|dist|node_modules)\/|\.d\.ts$|\.config\.(js|ts|mjs)$/;
export const TEST = /\.test\.|(^|\/)(test|__checks__)\//;

/** Whether a repo-relative path is a code file the checkers read. */
export const isCode = (file) => CODE.test(file) && !SKIPPED.test(file);

/** The project's code files git does not ignore, as `{ file, src }`, paths relative to the repo root it runs in. */
export function readSources(project) {
  return execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '--', project], { encoding: 'utf8' })
    .split('\n')
    .filter((file) => isCode(file) && existsSync(file))
    .map((file) => ({ file, src: readFileSync(file, 'utf8') }));
}

/** The project named on the command line, or a usage error. */
export function projectArg(script) {
  const project = process.argv[2];
  if (!PROJECTS.includes(project ?? '')) {
    console.error(`usage: node dev/lint/${script} <${PROJECTS.join('|')}>`);
    process.exit(64);
  }
  return project;
}

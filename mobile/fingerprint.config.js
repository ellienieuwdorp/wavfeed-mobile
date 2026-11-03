/**
 * What the runtime fingerprint leaves out: the sources that cannot change what the installed
 * binary offers JavaScript, so an update reaches every store build with the same native code. `ios/` and `android/` are
 * generated from the config the fingerprint already hashes, and a build's copy of the project may not see them as
 * gitignored (iOS build 4's fingerprint held its `ios/`), so they are ignored by path; `.gitignore` only matters to a
 * checked-in native project; `eas.json` and the npm scripts shape how a build is made and what its hook uploads, except
 * EAS Build's install hooks, which run beside prebuild and stay hashed; the app's version is a store label that changes
 * with a new build whose native side may be the same.
 */
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { SourceSkips } = require('expo/fingerprint');

const scripts = JSON.parse(readFileSync(join(__dirname, 'package.json'), 'utf8')).scripts ?? {};
const hooks = ['eas-build-pre-install', 'eas-build-post-install'].map((name) => [name, scripts[name] ?? null]);

/** @type {import('expo/fingerprint').Config} */
module.exports = {
  sourceSkips: SourceSkips.GitIgnore | SourceSkips.PackageJsonScriptsAll | SourceSkips.ExpoConfigVersions,
  ignorePaths: ['eas.json', 'ios/**/*', 'android/**/*'],
  extraSources: [{ type: 'contents', id: 'easBuildInstallHooks', contents: JSON.stringify(hooks), reasons: ['easBuildInstallHooks'] }],
};

/**
 * What the runtime fingerprint leaves out (task 0051, decision 1): the sources that cannot change what the installed
 * binary offers JavaScript, so an update reaches every store build with the same native code. `.gitignore` only matters
 * to a checked-in native project and ours are generated; `eas.json` and the npm scripts shape how a build is made and
 * what its hook uploads, not the binary's modules; the app's version is a store label that changes with a new build
 * whose native side may be the same.
 */
const { SourceSkips } = require('expo/fingerprint');

/** @type {import('expo/fingerprint').Config} */
module.exports = {
  sourceSkips: SourceSkips.GitIgnore | SourceSkips.PackageJsonScriptsAll | SourceSkips.ExpoConfigVersions,
  ignorePaths: ['eas.json'],
};

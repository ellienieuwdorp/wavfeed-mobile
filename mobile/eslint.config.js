// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require("eslint-config-expo/flat");

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ["dist/*"],
  },
  {
    // A release build logs warnings only; a development line goes through src/lib/devLog.ts (review PRIV-2).
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/**/*.test.ts", "src/store/__checks__/**"],
    rules: { "no-console": ["error", { allow: ["warn", "error"] }] },
  },
]);

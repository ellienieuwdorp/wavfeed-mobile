# wavfeed mobile

The phone app for iOS and Android: Expo SDK 57 with expo-router and
TypeScript. It signs into Bandcamp on the phone, gathers into SQLite there and
plays from it, with no server (ADR-0020). `CONTEXT.md`, at the repo root,
names everything in it.

## Run and check

- Use npm here, not pnpm. `npm install`, then `npx expo start --go` and scan
  the QR code with Expo Go. Without `--go` the QR code opens the development
  build, which `expo-dev-client` makes the default; a debug dev build carries
  the app's own native modules (`dev/sim.sh build`, `dev/emu.sh build`).
- `dev/check.sh mobile`, from the repo root, runs `npx tsc --noEmit`,
  oxlint (the root `.oxlintrc.json`, React Compiler rules included), knip
  (`knip.jsonc`) and the comment and size budgets (`comments.mjs`,
  `budgets.mjs`) from `dev/lint/`, and the tests. CI runs it with
  `--ci`, which adds the migration-number check, the fingerprint check,
  `expo install --check`, expo-doctor and an `expo export` of both bundles.
- `npm test` runs `src/**/*.test.ts` and `scripts/**/*.test.mjs` under
  `node --test` with no test dependency: Node 22.18 or later strips the
  types, `node:sqlite` stands in for `expo-sqlite` (`test/nodeDb.ts`), and
  `test/register.mjs` resolves the `@/` alias. Only code free of React Native
  loads there: `src/domain`, the store, the gather turn with its sink, and
  `src/tally`. `npm run test:coverage` adds coverage; `npm run perf` times
  the store's reads and the launch replay on 10,000 Stories.
- From another network, `dev/serve.sh` starts Metro on the Mac's VPN
  address and prints the `exp://` link for Expo Go; `dev/stop.sh` stops it.
  The Mac has to stay on power.

## The simulator and emulator rigs

`dev/sim.sh` drives an iOS 26 simulator (iPhone 17 Pro; `WAVFEED_SIM` picks
another) and `dev/emu.sh` an Android 16 emulator (AVD `wavfeed-api36`;
`WAVFEED_EMU` picks another), with no phone and no Bandcamp session. Each
runs its own Metro (8082 and 8083; logs in `/tmp/wavfeed-sim-metro.log` and
`/tmp/wavfeed-emu-metro.log`) with `EXPO_PUBLIC_SAMPLE=1`, which fills an
empty store from `src/dev/sample.ts` and runs no gather turn. The 8081 Metro
`serve.sh` runs is never touched.

| Command | What it does |
| --- | --- |
| `boot` | Boots the device (`emu.sh` creates the AVD when missing) |
| `serve` | Starts the rig's Metro, installs Expo Go if missing and opens the app |
| `open <route>` | Deep links to `/`, `releases`, `settings` (`bought` opens New releases); `releases?walk=1` stores a first walk mid-way, `?walk=0` finishes it |
| `play` | Opens the sample's showcase Release in the player |
| `reload` | Restarts the client, which also closes a sheet |
| `appearance dark`, `shot <name>` | Switches appearance; saves `dev/shots/<name>.png` (gitignored) |
| `font ax3` (iOS), `font 2.0` (Android) | Sets the text size; a cold `reload` lays views out at it |
| `back` (Android) | Presses the system back button |
| `build` | Prebuilds `ios/` or `android/` (gitignored), compiles the debug dev build with no signing and installs it; `WAVFEED_SIM_CLIENT=dev` or `WAVFEED_EMU_CLIENT=dev` then sends `serve`, `open`, `play` and `reload` to it |
| `stop` | Stops the rig's Metro; `emu.sh halt` stops the emulator |

- The sample bundle reaches no Bandcamp: every request answers as
  unreachable (`src/bandcamp/session.ts`). A heart's press is taken by the rig
  after 1.2 seconds (`src/dev/sampleWishlist.ts`);
  `EXPO_PUBLIC_SAMPLE_WISHLIST=refuse` makes it refuse instead. Settings >
  Remove everything reloads the sample.
- A running rig Metro keeps the values it started with, so `stop` it first;
  a start with changed values clears its cache.
- `emu.sh` needs JDK 17 and the Android SDK once: `brew install openjdk@17`,
  `brew install --cask android-commandlinetools`, accept the licences with
  `sdkmanager --licenses`, then install `platform-tools`, `emulator`,
  `system-images;android-36;google_apis;arm64-v8a` and `cmdline-tools;latest`
  into `~/Library/Android/sdk`, about 10 GB.
- Expo Go on Android has no lock screen service, so a play there warns where
  the dev build does not. The emulator lags its input while Gradle builds.

## Usage Tallies against a local Worker

A development bundle sends Tallies only with `EXPO_PUBLIC_TALLY_DEV=1` and
only to a local or VPN URL (`isLocalTallyUrl` in `src/tally/tally.ts`);
without it the ask and Settings > Usage stay hidden. The Tally backend's ingest
Worker lives in a private repository; with it running locally on port 8787:

```sh
EXPO_PUBLIC_TALLY_DEV=1 EXPO_PUBLIC_TALLY_URL=http://localhost:8787/v1/batch EXPO_PUBLIC_TALLY_KEY=wf_dev_local dev/sim.sh serve
```

The emulator reaches the Mac at `http://10.0.2.2:8787/v1/batch`, a phone at
the Mac's VPN address. The sample bundle shows the ask once after
launch, and Remove everything brings it back.

## The Demo

Connect's "Look around first" loads `src/demo/releases.ts` into an empty
store: real Releases with their art and previews, bought by made-up Fans, and
no gather turn until a sign-in replaces it. While the store holds the Demo
nothing is asked or queued. `node --import ./test/register.mjs
dev/curate-demo.ts` reads it afresh from public label pages with no cookie,
about a minute and a half of paced requests, and rewrites the file; a new
read ships by EAS Update.

## Releases

The author releases from the tip of `main`, from outside this repository
(ADR-0026, ADR-0028); a merge to `main` releases nothing. Per distribution
(TestFlight, Play and the website APK) a release sends an EAS Update when the
tree's native fingerprint is the newest released build's, makes a new build
when it is not, and sends nothing to a distribution that already has this
commit.

### The record is the tags

- `ios/build-<n>`, `android/build-<n>`, `apk/build-<n>` and
  `ota/<channel>/<platforms>/<date>-<group>`, annotated with trailers
  (`Distribution`, `Build`, `Runtime`, and `Url`, `Md5`, `Sha256` for the APK;
  `Group`, `Runtime`, `Rollout`, `Patch` for updates). Nothing records a
  release by hand.
- `node scripts/ledger.mjs` prints the newest build per distribution, and
  `git show ios/build-8` the commit a tester runs.
- `node scripts/fingerprint.mjs check` says which distributions an update from
  this tree would reach. CI runs it, and warns on a pull request whose native
  code means the next release builds anew.
- A `patch/<prefix>-<build>` branch is an old build's source with a fix, which
  an update can reach on that build's runtime alone.
- `dl.wavfeed.com` serves `store-builds.json`, which tells the app which builds
  testers can install, and the website APKs.

### Profiles

The EAS project is `@ellienieuwdorp/wavfeed`. `eas.json` holds four profiles,
each bound to the EAS environment of its name (`apk` to production's). Build
numbers live on EAS (`appVersionSource: "remote"`), so `app.json` holds the
version only.

| Profile | What it makes | Distribution | Update channel |
|---|---|---|---|
| `development` | the dev build, which loads its JavaScript from Metro | internal: registered devices only | none |
| `preview` | a release build for registered iPhones, and on Android an APK that installs on any phone; `autoIncrement` bumps the build number | internal | `preview` |
| `production` | the store build; `autoIncrement` bumps the build number | TestFlight, then its external group; Play's closed track (`alpha`) | `production` |
| `apk` | the production build as an Android APK with `WAVFEED_DISTRIBUTION=apk`, which lets it install the next one | `dl.wavfeed.com`, for phones without Play | `apk`, pointed at the `production` branch |

- Store builds are made with `eas build --local`, checked against the tree's
  fingerprint before upload.
- The website APK shares the Play build's fingerprint:
  `modules/apk-install-permission` adds `REQUEST_INSTALL_PACKAGES` to its
  manifest only. Its banner downloads the next APK, checks its MD5 and hands
  it to Android's installer; previews and older binaries open the browser
  download.
- `ios.privacyManifests` in `app.json` is the union of the required-reason
  APIs the native modules declare (`find node_modules -name
  PrivacyInfo.xcprivacy`); a new native module means checking it again.

### Updates

- The runtime version is a fingerprint of the native side, so an update
  lands only on binaries built from the same native code. `fingerprint.config.js`
  leaves out what cannot change the binary. CI's mobile job warns "Needs a new
  build" on a pull request that changes native code, and an update goes only
  to the platforms that match.
- Production and APK updates ship only a clean tree at the tip of `main`. The
  `apk` channel uses the `production` environment and targets Android alone.
- An update reaches every install of its runtime unless
  `--rollout-percentage <n>` stages it. While the iOS and Android
  fingerprints differ, one update is two groups, each widened and reverted on
  its own; `npx eas-cli update:list --branch production` shows both ids.
- Widen once the Tally board shows `app_opened` from the new update id and no
  `projection_replay_failed`: `npx eas-cli update:edit <group id>
  --rollout-percentage 50`, then 100. A new update with no `app_opened` at
  all is the warning, as is `store_open_failed`.
- Revert with `npx eas-cli update:revert-update-rollout --group <group id>`.
  At 100 percent, `npx eas-cli update:republish` puts an earlier update back,
  and `update:roll-back-to-embedded` the build's own JavaScript.

### Environments and source maps

- Each EAS environment sets `EXPO_PUBLIC_APP_ENV` to its name; a local Metro
  leaves it unset. `EXPO_PUBLIC_` values are inlined and public. `preview` and
  `production` also set `EXPO_PUBLIC_TALLY_KEY` and `EXPO_PUBLIC_TALLY_URL`,
  the full route `https://tallies-ingest.<subdomain>.workers.dev/v1/batch`; a
  build whose URL names another path never sends.
- After each `preview` or `production` build the `eas-build-on-success` hook
  (`scripts/upload-map.mjs`) puts the source map in the R2 bucket
  `tallies-maps` at `maps/wavfeed/<platform>/<build number>/index.map`, and
  each update's map goes under its update id. Both sign
  with a bucket-scoped R2 token held in those EAS environments:
  `TALLY_MAPS_KEY_ID` and `TALLY_MAPS_SECRET` (visibility Sensitive, so `eas
  env:exec` can read them) and `TALLY_MAPS_ENDPOINT`. With none of the three
  the hook uploads nothing; with only some, or a missing map, the build fails.

## Test devices

Each test iPhone that takes `development` or `preview` builds is registered
with `eas device:create`. The other account setup (the Apple and Play
accounts, the App Store Connect record, `submit.production.ios.ascAppId` in
`eas.json`, the first interactive `eas build` per platform) is done.

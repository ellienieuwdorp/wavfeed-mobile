#!/bin/sh
# The simulator rig (mobile/README.md): an iOS 26 simulator running Expo Go, or the debug dev build, against a second
# Metro on 8082 whose bundle fills the store with the sample and gathers nothing (src/dev/useSampleData.ts). It never
# touches 8081, where serve.sh serves the phone. Every simctl call names the device by UDID, since other simulators may
# be booted too.
set -eu
cd "$(dirname "$0")/.." || exit 1
PORT=8082
LOG=/tmp/wavfeed-sim-metro.log
SHOTS="$PWD/dev/shots"
BUNDLE="http://localhost:$PORT/node_modules/expo-router/entry.bundle?platform=ios&dev=true&hot=false&lazy=false&transform.routerRoot=src%2Fapp"
# WAVFEED_SIM_CLIENT=dev sends serve, open, play and reload to the dev build (`build`) instead of Expo Go.
if [ "${WAVFEED_SIM_CLIENT:-go}" = dev ]; then
  APP=com.wavfeed.app; LAUNCH="wavfeed://expo-development-client/?url=http%3A%2F%2Flocalhost%3A$PORT"; LINK=wavfeed://
else
  APP=host.exp.Exponent; LAUNCH="exp://localhost:$PORT"; LINK="exp://localhost:$PORT/--/"
fi

udid() {
  xcrun simctl list devices available -j | WANT="${WAVFEED_SIM:-}" python3 -c '
import json, os, re, sys
want = os.environ["WANT"]
runtimes = json.load(sys.stdin)["devices"]
ios26 = sorted((k for k in runtimes if re.search(r"SimRuntime\.iOS-26", k)), reverse=True)
for name in ([want] if want else []) + ["iPhone 17 Pro", "iPhone 17 Pro Max"]:
    for key in ios26:
        for d in runtimes[key]:
            if name in (d["name"], d["udid"]):
                print(d["udid"]); sys.exit(0)
sys.exit("no iOS 26 iPhone 17 Pro simulator; set WAVFEED_SIM to a name or UDID")'
}

state() { xcrun simctl list devices -j | UDID="$1" python3 -c 'import json, os, sys; print(next(d["state"] for r in json.load(sys.stdin)["devices"].values() for d in r if d["udid"] == os.environ["UDID"]))'; }

# Approves exp:// for Expo Go and wavfeed:// for the dev build. Exits 0 when it had to add one, 1 when both were there.
approve_schemes() {
  PLIST="$HOME/Library/Developer/CoreSimulator/Devices/$1/data/Library/Preferences/com.apple.launchservices.schemeapproval.plist" python3 -c '
import os, plistlib, sys
path = os.environ["PLIST"]
want = {"com.apple.CoreSimulator.CoreSimulatorBridge-->exp": "host.exp.Exponent",
        "com.apple.CoreSimulator.CoreSimulatorBridge-->wavfeed": "com.wavfeed.app"}
held = plistlib.load(open(path, "rb")) if os.path.exists(path) else {}
if all(held.get(k) == v for k, v in want.items()): sys.exit(1)
held.update(want)
os.makedirs(os.path.dirname(path), exist_ok=True)
plistlib.dump(held, open(path, "wb"), fmt=plistlib.FMT_BINARY)'
}

reload() {
  U="$(udid)"
  xcrun simctl terminate "$U" "$APP" 2>/dev/null || true
  xcrun simctl openurl "$U" "$LAUNCH"
}

listening() { lsof -nP -tiTCP:$PORT -sTCP:LISTEN 2>/dev/null | head -1; }

install_expo_go() {
  U="$1"
  xcrun simctl get_app_container "$U" host.exp.Exponent >/dev/null 2>&1 && return 0
  SDK="$(node -p 'require("expo/package.json").version.split(".")[0]').0.0"
  URL="$(curl -fsS https://api.expo.dev/v2/versions/latest | SDK="$SDK" python3 -c 'import json, os, sys; print(json.load(sys.stdin)["data"]["sdkVersions"][os.environ["SDK"]]["iosClientUrl"])')"
  CACHE="$HOME/.expo/ios-simulator-app-cache/$(basename "$URL" .tar.gz).app"
  if [ ! -d "$CACHE" ]; then
    echo "downloading Expo Go for SDK $SDK"
    mkdir -p "$CACHE"
    curl -fsSL "$URL" | tar -xz -C "$CACHE"
  fi
  xcrun simctl install "$U" "$CACHE"
}

# No developer-menu intro and no floating gear over the screens being shot, in Expo Go or the dev build.
quiet_client() {
  for KEY in EXDevMenuIsOnboardingFinished ExpoGoOnboardingFinished; do
    xcrun simctl spawn "$1" defaults write "$APP" "$KEY" -bool YES
  done
  xcrun simctl spawn "$1" defaults write "$APP" EXDevMenuShowFloatingActionButton -bool NO
  xcrun simctl spawn "$1" defaults write "$APP" EXDevMenuShowsAtLaunch -bool NO
}

case "${1:-}" in
  boot)
    U="$(udid)"
    # Expo CLI's own trick: approve the schemes before boot, so openurl raises no "Open in Expo Go?" alert.
    if approve_schemes "$U" && [ "$(state "$U")" = Booted ]; then xcrun simctl shutdown "$U"; fi
    xcrun simctl bootstatus "$U" -b >/dev/null
    echo "booted $U"
    ;;
  serve)
    U="$(udid)"
    if [ "$APP" = com.wavfeed.app ] && ! xcrun simctl get_app_container "$U" "$APP" >/dev/null 2>&1; then
      echo "no dev build on $U; run sim.sh build"; exit 1
    fi
    if [ -n "$(listening)" ]; then
      echo "Metro already listening on $PORT"
    else
      # Its own cache: a bundle with EXPO_PUBLIC_SAMPLE inlined must never reach the 8081 Metro.
      mkdir -p /tmp/wavfeed-sim-tmp
      # EXPO_PUBLIC_TALLY_DEV, _URL and _KEY reach the bundle from this shell (the local loop, README); a change to them
      # clears the cache, so no transform keeps the last run's values.
      TALLY="${EXPO_PUBLIC_TALLY_DEV:-}|${EXPO_PUBLIC_TALLY_URL:-}|${EXPO_PUBLIC_TALLY_KEY:-}"
      CLEAR=; [ "$TALLY" = "$(cat /tmp/wavfeed-sim-tmp/tally 2>/dev/null)" ] || CLEAR=--clear
      printf '%s' "$TALLY" >/tmp/wavfeed-sim-tmp/tally
      TMPDIR=/tmp/wavfeed-sim-tmp EXPO_PUBLIC_SAMPLE=1 EXPO_NO_TELEMETRY=1 REACT_NATIVE_PACKAGER_HOSTNAME=localhost \
        nohup npx expo start --port $PORT --localhost $CLEAR </dev/null >"$LOG" 2>&1 &
      for _ in $(seq 1 60); do
        sleep 1
        curl -s -o /dev/null "http://localhost:$PORT/status" && break
      done
    fi
    echo "bundling (the first one takes a minute)"
    curl -s -o /dev/null -w 'bundle %{http_code}\n' --max-time 300 "$BUNDLE" || true
    [ "$APP" = com.wavfeed.app ] || install_expo_go "$U"
    quiet_client "$U"
    xcrun simctl terminate "$U" "$APP" 2>/dev/null || true
    xcrun simctl openurl "$U" "$LAUNCH"
    echo "opened $LAUNCH on $U"
    ;;
  build)
    # The debug dev build carries the app's own native modules, where Expo Go carries its own build of them.
    U="$(udid)"
    # Prebuild rewrites package.json's android and ios scripts; they are put back however it ends.
    cp package.json /tmp/wavfeed-sim-package.json
    trap 'cp /tmp/wavfeed-sim-package.json package.json' EXIT INT TERM
    EXPO_NO_TELEMETRY=1 CI=1 npx expo prebuild --platform ios --no-install >/tmp/wavfeed-sim-xcode.log 2>&1 || { tail -20 /tmp/wavfeed-sim-xcode.log; exit 1; }
    cp /tmp/wavfeed-sim-package.json package.json
    trap - EXIT INT TERM
    echo "building (about ten minutes the first time, log in /tmp/wavfeed-sim-xcode.log)"
    (cd ios && LANG=en_US.UTF-8 pod install) >>/tmp/wavfeed-sim-xcode.log 2>&1 || { tail -20 /tmp/wavfeed-sim-xcode.log; exit 1; }
    # A simulator build needs no signing identity, so no Apple account is involved.
    xcodebuild -workspace ios/wavfeed.xcworkspace -scheme wavfeed -configuration Debug -destination "id=$U" \
      -derivedDataPath ios/build CODE_SIGNING_ALLOWED=NO build >>/tmp/wavfeed-sim-xcode.log 2>&1 || { tail -20 /tmp/wavfeed-sim-xcode.log; exit 1; }
    xcrun simctl install "$U" ios/build/Build/Products/Debug-iphonesimulator/wavfeed.app
    echo "installed the dev build on $U; WAVFEED_SIM_CLIENT=dev sim.sh serve starts Metro if none runs and opens it"
    ;;
  open)
    [ $# -ge 2 ] || { echo "usage: sim.sh open <path>, e.g. / or releases"; exit 1; }
    # A link to the root leaves the app on whichever tab it last showed; only a fresh launch lands on Feed.
    if [ -z "${2#/}" ]; then reload; else xcrun simctl openurl "$(udid)" "$LINK${2#/}"; fi
    ;;
  play)
    # The sample's showcase Release in the player sheet, no audio (src/dev/useSampleData.ts).
    xcrun simctl openurl "$(udid)" "${LINK}player?sample=1"
    ;;
  reload)
    reload
    ;;
  appearance)
    case "${2:-}" in light | dark) xcrun simctl ui "$(udid)" appearance "$2" ;; *) echo "usage: sim.sh appearance light|dark"; exit 1 ;; esac
    ;;
  font)
    # The Dynamic Type size, as simctl names it or by its short name; ax3 is accessibility-extra-large, AX3 in Settings.
    case "${2:-}" in
      default) SIZE=large ;;
      ax1) SIZE=accessibility-medium ;; ax2) SIZE=accessibility-large ;; ax3) SIZE=accessibility-extra-large ;;
      ax4) SIZE=accessibility-extra-extra-large ;; ax5) SIZE=accessibility-extra-extra-extra-large ;;
      extra-small | small | medium | large | extra-large | extra-extra-large | extra-extra-extra-large | accessibility-*) SIZE="$2" ;;
      *) echo "usage: sim.sh font default | ax1 to ax5 | <simctl content size>, e.g. extra-extra-large"; exit 1 ;;
    esac
    xcrun simctl ui "$(udid)" content_size "$SIZE"
    ;;
  shot)
    [ -n "${2:-}" ] || { echo "usage: sim.sh shot <name>"; exit 1; }
    mkdir -p "$SHOTS"
    xcrun simctl io "$(udid)" screenshot "$SHOTS/$2.png" >/dev/null 2>&1
    echo "$SHOTS/$2.png"
    ;;
  stop)
    PID="$(listening)"
    [ -n "$PID" ] && kill "$PID" && echo "stopped $PID" || echo "nothing on $PORT"
    ;;
  *)
    echo "usage: sim.sh boot | serve | build | open <path> | play | reload | appearance light|dark | font <size> | shot <name> | stop"
    exit 1
    ;;
esac

#!/bin/sh
# The simulator rig (mobile/README.md): an iOS 26 simulator running Expo Go against a second Metro on 8082 whose bundle
# fills the store with the sample and gathers nothing (src/dev/useSampleData.ts). It never touches 8081, where
# serve.sh serves the phone. Every simctl call names the device by UDID, since other simulators may be booted too.
set -eu
cd "$(dirname "$0")/.." || exit 1
PORT=8082
LOG=/tmp/wavfeed-sim-metro.log
SHOTS="$PWD/dev/shots"
BUNDLE="http://localhost:$PORT/node_modules/expo-router/entry.bundle?platform=ios&dev=true&hot=false&lazy=false&transform.routerRoot=src%2Fapp"

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

# Exits 0 when it had to add the approval, 1 when it was already there.
approve_exp() {
  PLIST="$HOME/Library/Developer/CoreSimulator/Devices/$1/data/Library/Preferences/com.apple.launchservices.schemeapproval.plist" python3 -c '
import os, plistlib, sys
path = os.environ["PLIST"]
key = "com.apple.CoreSimulator.CoreSimulatorBridge-->exp"
held = plistlib.load(open(path, "rb")) if os.path.exists(path) else {}
if held.get(key) == "host.exp.Exponent": sys.exit(1)
held[key] = "host.exp.Exponent"
os.makedirs(os.path.dirname(path), exist_ok=True)
plistlib.dump(held, open(path, "wb"), fmt=plistlib.FMT_BINARY)'
}

reload() {
  U="$(udid)"
  xcrun simctl terminate "$U" host.exp.Exponent 2>/dev/null || true
  xcrun simctl openurl "$U" "exp://localhost:$PORT"
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

# No developer-menu intro and no floating gear over the screens being shot.
quiet_expo_go() {
  for KEY in EXDevMenuIsOnboardingFinished ExpoGoOnboardingFinished; do
    xcrun simctl spawn "$1" defaults write host.exp.Exponent "$KEY" -bool YES
  done
  xcrun simctl spawn "$1" defaults write host.exp.Exponent EXDevMenuShowFloatingActionButton -bool NO
  xcrun simctl spawn "$1" defaults write host.exp.Exponent EXDevMenuShowsAtLaunch -bool NO
}

case "${1:-}" in
  boot)
    U="$(udid)"
    # Expo CLI's own trick: approve exp:// for Expo Go before boot, so openurl raises no "Open in Expo Go?" alert.
    if approve_exp "$U" && [ "$(state "$U")" = Booted ]; then xcrun simctl shutdown "$U"; fi
    xcrun simctl bootstatus "$U" -b >/dev/null
    echo "booted $U"
    ;;
  serve)
    U="$(udid)"
    if [ -n "$(listening)" ]; then
      echo "Metro already listening on $PORT"
    else
      # Its own cache: a bundle with EXPO_PUBLIC_SAMPLE inlined must never reach the 8081 Metro.
      mkdir -p /tmp/wavfeed-sim-tmp
      TMPDIR=/tmp/wavfeed-sim-tmp EXPO_PUBLIC_SAMPLE=1 EXPO_NO_TELEMETRY=1 REACT_NATIVE_PACKAGER_HOSTNAME=localhost \
        nohup npx expo start --port $PORT --localhost </dev/null >"$LOG" 2>&1 &
      for _ in $(seq 1 60); do
        sleep 1
        curl -s -o /dev/null "http://localhost:$PORT/status" && break
      done
    fi
    echo "bundling (the first one takes a minute)"
    curl -s -o /dev/null -w 'bundle %{http_code}\n' --max-time 300 "$BUNDLE" || true
    install_expo_go "$U"
    quiet_expo_go "$U"
    xcrun simctl terminate "$U" host.exp.Exponent 2>/dev/null || true
    xcrun simctl openurl "$U" "exp://localhost:$PORT"
    echo "opened exp://localhost:$PORT on $U"
    ;;
  open)
    [ $# -ge 2 ] || { echo "usage: sim.sh open <path>, e.g. / or releases"; exit 1; }
    # A link to the root leaves the app on whichever tab it last showed; only a fresh launch lands on Feed.
    if [ -z "${2#/}" ]; then reload; else xcrun simctl openurl "$(udid)" "exp://localhost:$PORT/--/${2#/}"; fi
    ;;
  play)
    # The sample's showcase Release in the player sheet, no audio (src/dev/useSampleData.ts).
    xcrun simctl openurl "$(udid)" "exp://localhost:$PORT/--/player?sample=1"
    ;;
  reload)
    reload
    ;;
  appearance)
    case "${2:-}" in light | dark) xcrun simctl ui "$(udid)" appearance "$2" ;; *) echo "usage: sim.sh appearance light|dark"; exit 1 ;; esac
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
    echo "usage: sim.sh boot | serve | open <path> | play | reload | appearance light|dark | shot <name> | stop"
    exit 1
    ;;
esac

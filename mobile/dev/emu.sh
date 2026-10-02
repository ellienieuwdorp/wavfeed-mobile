#!/bin/sh
# The emulator rig (mobile/README.md), sim.sh's Android twin: an Android 16 emulator running Expo Go, or the debug dev
# build, against a third Metro on 8083 whose bundle fills the store with the sample and gathers nothing
# (src/dev/useSampleData.ts). It never touches 8081 (serve.sh, the phone) or 8082 (sim.sh). Every adb call names the
# emulator by serial, since a phone may be plugged in too.
set -eu
cd "$(dirname "$0")/.." || exit 1
PORT=8083
LOG=/tmp/wavfeed-emu-metro.log
SHOTS="$PWD/dev/shots"
AVD="${WAVFEED_EMU:-wavfeed-api36}"
IMAGE="system-images;android-36;google_apis;arm64-v8a"
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
export JAVA_HOME="${JAVA_HOME:-/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home}"
ADB="$ANDROID_HOME/platform-tools/adb"
BUNDLE="http://localhost:$PORT/node_modules/expo-router/entry.bundle?platform=android&dev=true&hot=false&lazy=false&transform.routerRoot=src%2Fapp"
# WAVFEED_EMU_CLIENT=dev sends serve, open, play and reload to the dev build (`build`) instead of Expo Go.
if [ "${WAVFEED_EMU_CLIENT:-go}" = dev ]; then APP=com.wavfeed.app; LINK=wavfeed://; else APP=host.exp.exponent; LINK="exp://localhost:$PORT/--/"; fi

# The serial of the running emulator whose AVD is $AVD, empty when it is not up.
serial() {
  for S in $("$ADB" devices | awk '$2 == "device" && $1 ~ /^emulator-/ { print $1 }'); do
    [ "$("$ADB" -s "$S" emu avd name 2>/dev/null | head -1 | tr -d '\r')" = "$AVD" ] && { echo "$S"; return 0; }
  done
  return 0
}

# Every branch binds S="$(device)" on its own line: an assignment's failed substitution stops the script under set -e.
device() {
  S="$(serial)"
  [ -n "$S" ] || { echo "the $AVD emulator is not running; run emu.sh boot" >&2; exit 1; }
  echo "$S"
}

listening() { lsof -nP -tiTCP:$PORT -sTCP:LISTEN 2>/dev/null | head -1; }

install_expo_go() {
  "$ADB" -s "$1" shell pm path host.exp.exponent >/dev/null 2>&1 && return 0
  SDK="$(node -p 'require("expo/package.json").version.split(".")[0]').0.0"
  URL="$(curl -fsS https://api.expo.dev/v2/versions/latest | SDK="$SDK" python3 -c 'import json, os, sys; print(json.load(sys.stdin)["data"]["sdkVersions"][os.environ["SDK"]]["androidClientUrl"])')"
  APK="$HOME/.expo/android-apk-cache/$(basename "$URL")"
  if [ ! -f "$APK" ]; then
    echo "downloading Expo Go for SDK $SDK"
    mkdir -p "$(dirname "$APK")"
    curl -fsSL -o "$APK" "$URL"
  fi
  "$ADB" -s "$1" install -r "$APK" >/dev/null
}

# A force-stop straight before a start races the dying process and the launcher closes, so the start waits.
launch() {
  "$ADB" -s "$1" shell am force-stop "$APP"
  sleep 2
  if [ "$APP" = com.wavfeed.app ]; then
    "$ADB" -s "$1" shell monkey -p "$APP" -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1
  else
    "$ADB" -s "$1" shell am start -a android.intent.action.VIEW -d "exp://localhost:$PORT" "$APP" >/dev/null
  fi
}

case "${1:-}" in
  boot)
    [ -x "$ANDROID_HOME/emulator/emulator" ] || { echo "no emulator under $ANDROID_HOME; see mobile/README.md"; exit 1; }
    if [ -z "$(serial)" ]; then
      if ! "$ANDROID_HOME/emulator/emulator" -list-avds | grep -qx "$AVD"; then
        echo no | "$ANDROID_HOME/cmdline-tools/latest/bin/avdmanager" create avd -n "$AVD" -k "$IMAGE" -d pixel_9 >/dev/null
        sed -i '' 's/^hw.ramSize=.*/hw.ramSize=4096/' "$HOME/.android/avd/$AVD.avd/config.ini"
      fi
      nohup "$ANDROID_HOME/emulator/emulator" -avd "$AVD" -no-snapshot-save -no-boot-anim -gpu host </dev/null >/tmp/wavfeed-emu.log 2>&1 &
      for _ in $(seq 1 60); do
        sleep 2
        [ -n "$(serial)" ] && break
      done
    fi
    S="$(device)"
    for _ in $(seq 1 150); do
      [ "$("$ADB" -s "$S" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = 1 ] && { echo "booted $AVD as $S"; exit 0; }
      sleep 2
    done
    echo "$AVD did not finish booting; see /tmp/wavfeed-emu.log"
    exit 1
    ;;
  serve)
    S="$(device)"
    if [ -n "$(listening)" ]; then
      echo "Metro already listening on $PORT"
    else
      # Its own cache: a bundle with EXPO_PUBLIC_SAMPLE inlined must never reach the 8081 Metro.
      mkdir -p /tmp/wavfeed-emu-tmp
      # EXPO_PUBLIC_TALLY_DEV, _URL and _KEY and EXPO_PUBLIC_SAMPLE_WISHLIST reach the bundle from this shell (README); a
      # change to them clears the cache, so no transform keeps the last run's values.
      INLINED="${EXPO_PUBLIC_TALLY_DEV:-}|${EXPO_PUBLIC_TALLY_URL:-}|${EXPO_PUBLIC_TALLY_KEY:-}|${EXPO_PUBLIC_SAMPLE_WISHLIST:-}"
      CLEAR=; [ "$INLINED" = "$(cat /tmp/wavfeed-emu-tmp/inlined 2>/dev/null)" ] || CLEAR=--clear
      printf '%s' "$INLINED" >/tmp/wavfeed-emu-tmp/inlined
      TMPDIR=/tmp/wavfeed-emu-tmp EXPO_PUBLIC_SAMPLE=1 EXPO_NO_TELEMETRY=1 REACT_NATIVE_PACKAGER_HOSTNAME=localhost \
        nohup npx expo start --port $PORT --localhost $CLEAR </dev/null >"$LOG" 2>&1 &
      for _ in $(seq 1 60); do
        sleep 1
        curl -s -o /dev/null "http://localhost:$PORT/status" && break
      done
    fi
    "$ADB" -s "$S" reverse tcp:$PORT tcp:$PORT >/dev/null
    echo "bundling (the first one takes a minute)"
    curl -s -o /dev/null -w 'bundle %{http_code}\n' --max-time 300 "$BUNDLE" || true
    if [ "$APP" = com.wavfeed.app ]; then
      launch "$S"
      echo "opened the dev build on $S"
    else
      install_expo_go "$S"
      launch "$S"
      echo "opened exp://localhost:$PORT on $S (Expo Go shows its developer menu on the first launch; close it)"
    fi
    ;;
  build)
    # The debug dev build carries the app's own native modules, where Expo Go carries its own build of them.
    S="$(device)"
    [ -d "$JAVA_HOME" ] || { echo "no JDK 17 at $JAVA_HOME; see mobile/README.md"; exit 1; }
    # Prebuild rewrites package.json's android and ios scripts; they are put back however it ends.
    cp package.json /tmp/wavfeed-emu-package.json
    trap 'cp /tmp/wavfeed-emu-package.json package.json' EXIT INT TERM
    EXPO_NO_TELEMETRY=1 CI=1 npx expo prebuild --platform android --no-install >/tmp/wavfeed-emu-gradle.log 2>&1 || { tail -20 /tmp/wavfeed-emu-gradle.log; exit 1; }
    cp /tmp/wavfeed-emu-package.json package.json
    trap - EXIT INT TERM
    echo "building (about six minutes the first time, log in /tmp/wavfeed-emu-gradle.log)"
    (cd android && ./gradlew :app:assembleDebug -PreactNativeArchitectures=arm64-v8a --console=plain) >>/tmp/wavfeed-emu-gradle.log 2>&1 || { tail -20 /tmp/wavfeed-emu-gradle.log; exit 1; }
    "$ADB" -s "$S" install -r android/app/build/outputs/apk/debug/app-debug.apk >/dev/null
    # A debug build asks localhost:8081 for its bundle; React Native's debug_http_host preference sends it to 8083.
    "$ADB" -s "$S" shell "run-as com.wavfeed.app sh -c 'mkdir -p shared_prefs && echo \"<?xml version=\\\"1.0\\\" encoding=\\\"utf-8\\\" standalone=\\\"yes\\\" ?><map><string name=\\\"debug_http_host\\\">localhost:$PORT</string></map>\" > shared_prefs/com.wavfeed.app_preferences.xml'"
    echo "installed the dev build on $S; WAVFEED_EMU_CLIENT=dev emu.sh serve starts Metro if none runs and opens it"
    ;;
  open)
    [ $# -ge 2 ] || { echo "usage: emu.sh open <path>, e.g. / or releases"; exit 1; }
    S="$(device)"
    if [ -z "${2#/}" ]; then launch "$S"; else "$ADB" -s "$S" shell am start -a android.intent.action.VIEW -d "$LINK${2#/}" "$APP" >/dev/null; fi
    ;;
  play)
    # The sample's showcase Release in the player sheet, no audio (src/dev/useSampleData.ts).
    S="$(device)"
    "$ADB" -s "$S" shell am start -a android.intent.action.VIEW -d "${LINK}player?sample=1" "$APP" >/dev/null
    ;;
  reload)
    S="$(device)"
    launch "$S"
    ;;
  back)
    S="$(device)"
    "$ADB" -s "$S" shell input keyevent KEYCODE_BACK
    ;;
  appearance)
    case "${2:-}" in light) NIGHT=no ;; dark) NIGHT=yes ;; *) echo "usage: emu.sh appearance light|dark"; exit 1 ;; esac
    S="$(device)"
    "$ADB" -s "$S" shell cmd uimode night "$NIGHT" >/dev/null
    ;;
  font)
    [ -n "${2:-}" ] || { echo "usage: emu.sh font <scale>, e.g. 1.0 or 2.0"; exit 1; }
    S="$(device)"
    "$ADB" -s "$S" shell settings put system font_scale "$2"
    ;;
  shot)
    [ -n "${2:-}" ] || { echo "usage: emu.sh shot <name>"; exit 1; }
    S="$(device)"
    mkdir -p "$SHOTS"
    "$ADB" -s "$S" exec-out screencap -p >"$SHOTS/$2.png"
    echo "$SHOTS/$2.png"
    ;;
  stop)
    PID="$(listening)"
    [ -n "$PID" ] && kill "$PID" && echo "stopped $PID" || echo "nothing on $PORT"
    ;;
  halt)
    S="$(serial)"
    [ -n "$S" ] && "$ADB" -s "$S" emu kill >/dev/null && echo "stopped $AVD" || echo "$AVD is not running"
    ;;
  *)
    echo "usage: emu.sh boot | serve | build | open <path> | play | reload | back | appearance light|dark | font <scale> | shot <name> | stop | halt"
    exit 1
    ;;
esac

#!/bin/sh
# Starts Metro for Expo Go on the tailnet address, so the phone loads the app from
# any network. The Tailscale CLI is not on PATH on this Mac; caffeinate keeps the
# laptop from idling while the server is up. Logs go to /tmp/wavfeed-metro.log.
cd "$(dirname "$0")/.." || exit 1
TS=/Applications/Tailscale.app/Contents/MacOS/Tailscale
IP="$("$TS" ip -4 2>/dev/null | head -1)"
[ -n "$IP" ] || { echo "Tailscale is not up on this Mac"; exit 1; }
if lsof -nP -iTCP:8081 -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Metro already listening on 8081"
else
  REACT_NATIVE_PACKAGER_HOSTNAME="$IP" EXPO_NO_TELEMETRY=1 \
    nohup caffeinate -is npx expo start --port 8081 --lan </dev/null >/tmp/wavfeed-metro.log 2>&1 &
  for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do
    sleep 2
    curl -s -o /dev/null "http://127.0.0.1:8081/status" && break
  done
fi
echo "Open in Expo Go: exp://$IP:8081"

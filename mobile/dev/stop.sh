#!/bin/sh
# Stops the Metro started by serve.sh (only the listener on 8081, nothing else).
PID="$(lsof -nP -tiTCP:8081 -sTCP:LISTEN 2>/dev/null | head -1)"
[ -n "$PID" ] && kill "$PID" && echo "stopped $PID" || echo "nothing on 8081"

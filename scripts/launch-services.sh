#!/bin/bash
# MedSync-AI service launcher — survives tool-session cleanup.
#
# IMPORTANT (discovered 2026-09-29): processes started as normal background
# jobs of a tool-session shell are reaped when the call ends. The ONLY launch
# pattern that survives is a double-fork orphan: a subshell backgrounds a
# setsid'd process and exits immediately, so the process is reparented to
# PID 1 (tini) — exactly how the platform's boot script leaves them.
#
# Usage:  bash scripts/launch-services.sh [--skip-next] [--skip-socket]
cd "$(dirname "$0")/.."

SKIP_NEXT=0
SKIP_SOCKET=0
for arg in "$@"; do
  case "$arg" in
    --skip-next) SKIP_NEXT=1 ;;
    --skip-socket) SKIP_SOCKET=1 ;;
  esac
done

if [ "$SKIP_NEXT" -eq 0 ] && ! ss -tln 2>/dev/null | grep -q ":3000 "; then
  ( setsid ./node_modules/.bin/next dev -p 3000 < /dev/null > dev.log 2>&1 & )
  echo "[launch] Next.js dev server starting on :3000 (log: dev.log)"
elif [ "$SKIP_NEXT" -eq 0 ]; then
  echo "[launch] Next.js already running on :3000"
fi

if [ "$SKIP_SOCKET" -eq 0 ] && ! ss -tln 2>/dev/null | grep -q ":3003 "; then
  (
    cd mini-services/socket-service
    ( setsid bun --hot index.ts < /dev/null > ../../.zscripts/mini-service-socket-service.log 2>&1 & )
  )
  echo "[launch] socket service starting on :3003 (bridge :3004)"
elif [ "$SKIP_SOCKET" -eq 0 ]; then
  echo "[launch] socket service already running on :3003"
fi

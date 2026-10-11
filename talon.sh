#!/usr/bin/env bash
# TALON one-click start (macOS / Linux). Double-click or run ./talon.sh
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo "[talon] Node.js is not installed. Get Node 22.12+ from https://nodejs.org/ and run this again."
  read -r -p "Press Enter to close…" _
  exit 1
fi
[ -f scripts/launch.mjs ] || { echo "[talon] scripts/launch.mjs is missing: re-download the ZIP from https://github.com/firhini/Talon and extract everything"; exit 1; }
node scripts/launch.mjs "$@"
status=$?
if [ $status -ne 0 ]; then
  echo
  echo "[talon] launcher exited with code $status"
  read -r -p "Press Enter to close…" _
fi
exit $status

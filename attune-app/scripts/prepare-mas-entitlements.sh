#!/usr/bin/env bash
# Generates src-tauri/Entitlements.mas.plist from template (requires APPLE_TEAM_ID).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TEMPLATE="$ROOT/src-tauri/Entitlements.mas.plist.in"
OUT="$ROOT/src-tauri/Entitlements.mas.plist"

if [[ -z "${APPLE_TEAM_ID:-}" ]]; then
  echo "error: set APPLE_TEAM_ID to your 10-character Apple Developer Team ID" >&2
  echo "  export APPLE_TEAM_ID=XXXXXXXXXX" >&2
  exit 1
fi

sed "s/@APPLE_TEAM_ID@/${APPLE_TEAM_ID}/g" "$TEMPLATE" > "$OUT"
echo "Wrote $OUT (team ${APPLE_TEAM_ID})"

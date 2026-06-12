#!/usr/bin/env bash
# Set GitHub repo description, homepage, and topics (About section).
# Requires: gh auth login
set -euo pipefail

REPO="${1:-vivpra89/Attune}"

gh repo edit "$REPO" \
  --description "Real-time attention layer for children's learning — on-device macOS app with Apple Vision & Core ML" \
  --homepage "https://attune.ai" \
  --add-topic macos \
  --add-topic tauri \
  --add-topic coreml \
  --add-topic education \
  --add-topic attention \
  --add-topic react \
  --add-topic rust \
  --add-topic swift \
  --add-topic machine-learning \
  --add-topic computer-vision

echo "Updated https://github.com/${REPO} About section."

#!/usr/bin/env bash
# Bootstrap on-device inference models (no Attune training data required).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if ! command -v python3 &>/dev/null; then
  echo "python3 required"
  exit 1
fi

python3 -m venv "$ROOT/ml/.venv" 2>/dev/null || true
# shellcheck disable=SC1091
source "$ROOT/ml/.venv/bin/activate"
pip install -q -r "$ROOT/ml/requirements.txt"

echo "==> Downloading pretrained MobileGaze (Gaze360) weights → Core ML"
python "$ROOT/ml/download_pretrained.py" --compile

echo "==> HSEmotion affect model (pretrained EfficientNet-B0)"
cd "$ROOT/attune-app" && npm run convert:affect

echo "==> Landmark Core ML helpers (engagement structure)"
python "$ROOT/ml/generate_v0_models.py" --compile --skip-gaze

echo "==> Verifying model contracts"
python "$ROOT/ml/verify_models.py"

echo "Done. Run the app: cd attune-app && npm run tauri dev"

#!/usr/bin/env python3
"""Download public gaze-estimation weights and export Core ML for on-device inference.

Uses MobileOne-S0 trained on Gaze360 (yakhyo/gaze-estimation, MIT).
No Attune session data required.

  python download_pretrained.py --compile
"""

from __future__ import annotations

import argparse
import subprocess
import sys
import urllib.request
from pathlib import Path

import coremltools as ct
import torch

ML_DIR = Path(__file__).parent
sys.path.insert(0, str(ML_DIR))

from pretrained.gaze_wrapper import load_pretrained_gaze  # noqa: E402

WEIGHTS_URL = (
    "https://github.com/yakhyo/gaze-estimation/releases/download/weights/mobileone_s0.pt"
)
DEFAULT_WEIGHTS = ML_DIR / "weights" / "mobileone_s0.pt"
DEFAULT_OUTPUT = ML_DIR.parent / "attune-app" / "src-tauri" / "models" / "AttuneGazePretrained.mlmodel"


def download_weights(dest: Path) -> Path:
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.exists() and dest.stat().st_size > 1_000_000:
        print(f"Using cached weights: {dest}")
        return dest
    print(f"Downloading {WEIGHTS_URL} ...")
    urllib.request.urlretrieve(WEIGHTS_URL, dest)
    print(f"Saved {dest} ({dest.stat().st_size // 1024} KB)")
    return dest


def compile_model(mlmodel_path: Path) -> None:
    output = mlmodel_path.with_suffix(".mlmodelc")
    if output.exists():
        import shutil

        shutil.rmtree(output)
    subprocess.run(
        ["xcrun", "coremlcompiler", "compile", str(mlmodel_path), str(mlmodel_path.parent)],
        check=True,
    )
    print(f"Compiled {output}")


class _PreprocessAndGaze(torch.nn.Module):
    """Input: RGB float NCHW in [0, 1] (face crop)."""

    def __init__(self, gaze: torch.nn.Module):
        super().__init__()
        self.gaze = gaze
        self.register_buffer("mean", torch.tensor([0.485, 0.456, 0.406]).view(1, 3, 1, 1))
        self.register_buffer("std", torch.tensor([0.229, 0.224, 0.225]).view(1, 3, 1, 1))

    def forward(self, image: torch.Tensor):
        x = (image - self.mean) / self.std
        return self.gaze(x)


def export_coreml(model: torch.nn.Module, output_path: Path) -> None:
    wrapped = _PreprocessAndGaze(model)
    wrapped.eval()
    example = torch.rand(1, 3, 448, 448)
    traced = torch.jit.trace(wrapped, example)
    mlmodel = ct.convert(
        traced,
        inputs=[ct.TensorType(name="image", shape=(1, 3, 448, 448))],
        outputs=[
            ct.TensorType(name="gaze_away"),
            ct.TensorType(name="yaw_norm"),
            ct.TensorType(name="pitch_norm"),
        ],
        minimum_deployment_target=ct.target.macOS11,
        convert_to="neuralnetwork",
    )
    mlmodel.author = "yakhyo/gaze-estimation (MobileOne-S0, Gaze360)"
    mlmodel.short_description = "Pretrained gaze-away from face crop; not trained on Attune data."
    mlmodel.license = "MIT"
    output_path.parent.mkdir(parents=True, exist_ok=True)
    mlmodel.save(str(output_path))
    print(f"Exported {output_path}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--weights", type=Path, default=DEFAULT_WEIGHTS)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--compile", action="store_true")
    args = parser.parse_args()

    weights = download_weights(args.weights)
    model = load_pretrained_gaze(str(weights))
    export_coreml(model, args.output)
    if args.compile:
        compile_model(args.output)


if __name__ == "__main__":
    main()

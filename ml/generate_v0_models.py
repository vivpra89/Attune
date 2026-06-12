#!/usr/bin/env python3
"""Generate v0 Core ML models for Attune (engagement, gaze-away).

Affect uses pretrained HSEmotion — run `npm run convert:affect` instead of synthetic training.

After collecting real sessions, retrain engagement/gaze with:
  python export_session_features.py && python train_from_sessions.py --compile
"""

import argparse
import subprocess
import sys
from pathlib import Path

from constants import FEATURE_DIM, GAZE_FEATURE_DIM, MODEL_NAMES


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


def export_gaze_model(output_path: Path) -> None:
    import coremltools as ct
    import torch
    import torch.nn as nn

    class GazeNet(nn.Module):
        def __init__(self):
            super().__init__()
            self.net = nn.Sequential(
                nn.Linear(GAZE_FEATURE_DIM, 8),
                nn.ReLU(),
                nn.Linear(8, 1),
                nn.Sigmoid(),
            )

        def forward(self, x):
            return self.net(x)

    model = GazeNet()
    model.eval()
    traced = torch.jit.trace(model, torch.randn(1, GAZE_FEATURE_DIM))
    mlmodel = ct.convert(
        traced,
        inputs=[ct.TensorType(name="features", shape=(1, GAZE_FEATURE_DIM))],
        outputs=[ct.TensorType(name="gaze_away")],
        minimum_deployment_target=ct.target.macOS11,
        convert_to="neuralnetwork",
    )
    mlmodel.save(str(output_path))
    print(f"Saved {output_path}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=Path("attune-app/src-tauri/models"),
        help="Directory for .mlmodel and .mlmodelc files",
    )
    parser.add_argument("--compile", action="store_true", help="Compile models with coremlcompiler")
    parser.add_argument(
        "--skip-gaze",
        action="store_true",
        help="Skip AttuneGazeAway (use download_pretrained.py for gaze)",
    )
    args = parser.parse_args()
    ml_dir = Path(__file__).parent
    repo_root = ml_dir.parent
    output_dir = args.output_dir if args.output_dir.is_absolute() else repo_root / args.output_dir
    output_dir.mkdir(parents=True, exist_ok=True)

    scripts = [
        ("train_engagement.py", output_dir / f"{MODEL_NAMES['engagement']}.mlmodel"),
        ("train_affect.py", output_dir / f"{MODEL_NAMES['affect']}.mlmodel"),
    ]
    for script, out in scripts:
        subprocess.run(
            [sys.executable, str(ml_dir / script), "--output", str(out)],
            check=True,
            cwd=str(ml_dir),
        )
        if args.compile:
            compile_model(out)

    if not args.skip_gaze:
        gaze_path = output_dir / f"{MODEL_NAMES['gaze']}.mlmodel"
        export_gaze_model(gaze_path)
        if args.compile:
            compile_model(gaze_path)
    else:
        print("Skipped gaze placeholder — use ml/download_pretrained.py")


if __name__ == "__main__":
    main()

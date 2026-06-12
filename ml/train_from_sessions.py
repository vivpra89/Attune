#!/usr/bin/env python3
"""Retrain AttuneEngagement and AttuneGazeAway from exported session / ML samples."""

from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path

import coremltools as ct
import numpy as np
import pandas as pd
import torch
import torch.nn as nn
from torch.utils.data import DataLoader, TensorDataset


class EngagementNet(nn.Module):
    def __init__(self, input_dim: int = 32):
        super().__init__()
        self.net = nn.Sequential(
            nn.Linear(input_dim, 64),
            nn.ReLU(),
            nn.Linear(64, 32),
            nn.ReLU(),
            nn.Linear(32, 1),
            nn.Sigmoid(),
        )

    def forward(self, x):
        return self.net(x)


class GazeNet(nn.Module):
    def __init__(self):
        super().__init__()
        self.net = nn.Sequential(
            nn.Linear(3, 16),
            nn.ReLU(),
            nn.Linear(16, 8),
            nn.ReLU(),
            nn.Linear(8, 1),
            nn.Sigmoid(),
        )

    def forward(self, x):
        return self.net(x)


def compile_model(mlmodel_path: Path) -> None:
    output = mlmodel_path.with_suffix(".mlmodelc")
    if output.exists():
        import shutil

        shutil.rmtree(output)
    subprocess.run(
        ["xcrun", "coremlcompiler", "compile", str(mlmodel_path), str(mlmodel_path.parent)],
        check=True,
    )


def load_training_data(export_dir: Path) -> tuple[pd.DataFrame, pd.DataFrame]:
    ml_path = export_dir / "ml_inference_samples.parquet"
    att_path = export_dir / "attention_samples.parquet"
    if not ml_path.exists():
        raise FileNotFoundError(f"Run export_session_features.py first: missing {ml_path}")

    ml = pd.read_parquet(ml_path)
    if att_path.exists():
        att = pd.read_parquet(att_path)
        merged = ml.merge(
            att[["session_id", "ts", "score", "opacity", "feedback_state"]],
            on=["session_id", "ts"],
            how="left",
        )
    else:
        merged = ml.copy()
        merged["score"] = 50.0
        merged["opacity"] = 0.0

    # Weak labels for engagement: high attention score + low opacity dim
    merged["engagement_label"] = np.clip(
        (merged["score"].fillna(50) / 100.0) * (1.0 - merged["opacity"].fillna(0) * 0.5),
        0,
        1,
    )
    # Gaze-away label: high gaze_away or dimmed state
    merged["gaze_label"] = np.clip(
        merged["gaze_away"].fillna(0.2)
        + (merged["feedback_state"].fillna("focused") == "dimmed").astype(float) * 0.35,
        0,
        1,
    )
    return merged, ml


def train_engagement(df: pd.DataFrame, output: Path, input_dim: int = 32) -> None:
    rng = np.random.default_rng(42)
    n = len(df)
    if n < 100:
        print(f"Only {n} samples — using augmented bootstrap for engagement model")
    x = rng.random((max(n, 500), input_dim)).astype(np.float32)
    if n >= 100:
        # Use gaze + engagement as proxy features when landmark vectors unavailable in export
        base = df[["engagement", "gaze_away"]].values.astype(np.float32)
        x = np.tile(base, (1, input_dim // 2 + 1))[:, :input_dim]
        x += rng.normal(0, 0.05, x.shape).astype(np.float32)
    y = (
        df["engagement_label"].values.astype(np.float32).reshape(-1, 1)
        if n >= 100
        else (0.35 * x[:, 0] + 0.4 * x[:, 1] + 0.25 * x[:, 2]).clip(0, 1).reshape(-1, 1)
    )
    if n < 100:
        y = (0.35 * x[:, 0] + 0.4 * x[:, 1] + 0.25 * x[:, 2]).clip(0, 1).reshape(-1, 1).astype(
            np.float32
        )

    model = EngagementNet(input_dim)
    opt = torch.optim.Adam(model.parameters(), lr=1e-3)
    loss_fn = nn.MSELoss()
    loader = DataLoader(
        TensorDataset(torch.from_numpy(x), torch.from_numpy(y)),
        batch_size=64,
        shuffle=True,
    )
    model.train()
    for _ in range(30):
        for bx, by in loader:
            opt.zero_grad()
            loss = loss_fn(model(bx), by)
            loss.backward()
            opt.step()

    model.eval()
    traced = torch.jit.trace(model, torch.randn(1, input_dim))
    mlmodel = ct.convert(
        traced,
        inputs=[ct.TensorType(name="features", shape=(1, input_dim))],
        outputs=[ct.TensorType(name="engagement")],
        minimum_deployment_target=ct.target.macOS12,
    )
    output.parent.mkdir(parents=True, exist_ok=True)
    mlmodel.save(str(output))
    print(f"Saved engagement model to {output}")


def train_gaze(df: pd.DataFrame, output: Path) -> None:
    # Proxy: train on gaze_away labels; yaw/pitch/eye_open filled from statistics when missing
    gaze = df["gaze_away"].values.astype(np.float32)
    yaw = np.full(len(df), 0.15, dtype=np.float32)
    pitch = np.full(len(df), 0.12, dtype=np.float32)
    eye = np.full(len(df), 0.6, dtype=np.float32)
    x = np.stack([yaw, pitch, eye], axis=1)
    y = gaze.reshape(-1, 1)

    model = GazeNet()
    opt = torch.optim.Adam(model.parameters(), lr=1e-3)
    loss_fn = nn.BCELoss()
    loader = DataLoader(
        TensorDataset(torch.from_numpy(x), torch.from_numpy(y)),
        batch_size=64,
        shuffle=True,
    )
    model.train()
    for _ in range(40):
        for bx, by in loader:
            opt.zero_grad()
            loss = loss_fn(model(bx), by)
            loss.backward()
            opt.step()

    model.eval()
    traced = torch.jit.trace(model, torch.randn(1, 3))
    mlmodel = ct.convert(
        traced,
        inputs=[
            ct.TensorType(name="yaw", shape=(1, 1)),
            ct.TensorType(name="pitch", shape=(1, 1)),
            ct.TensorType(name="eye_open", shape=(1, 1)),
        ],
        outputs=[ct.TensorType(name="gaze_away")],
        minimum_deployment_target=ct.target.macOS12,
    )
    mlmodel.save(str(output))
    print(f"Saved gaze model to {output}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--export-dir",
        type=Path,
        default=Path("ml/data/export"),
    )
    parser.add_argument(
        "--models-dir",
        type=Path,
        default=Path("attune-app/models"),
    )
    parser.add_argument("--compile", action="store_true")
    args = parser.parse_args()

    merged, _ = load_training_data(args.export_dir)
    if len(merged) < 20:
        print("Fewer than 20 ML samples — run generate_v0_models.py for placeholders.")
        sys.exit(1)

    eng_path = args.models_dir / "AttuneEngagement.mlmodel"
    gaze_path = args.models_dir / "AttuneGazeAway.mlmodel"
    train_engagement(merged, eng_path)
    train_gaze(merged, gaze_path)

    affect_script = Path(__file__).parent / "train_affect.py"
    affect_path = args.models_dir / "AttuneAffect.mlmodel"
    subprocess.run(
        [sys.executable, str(affect_script), "--output", str(affect_path)],
        check=True,
    )

    if args.compile:
        compile_model(eng_path)
        compile_model(gaze_path)
        compile_model(affect_path)


if __name__ == "__main__":
    main()

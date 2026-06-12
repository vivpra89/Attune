#!/usr/bin/env python3
"""Train engagement regression model and export to Core ML."""

import argparse
from pathlib import Path

import coremltools as ct
import numpy as np
import torch
import torch.nn as nn
from torch.utils.data import DataLoader, TensorDataset


from constants import FEATURE_DIM


class EngagementNet(nn.Module):
    def __init__(self, input_dim: int = FEATURE_DIM):
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


def train(input_dim: int = FEATURE_DIM, epochs: int = 20) -> EngagementNet:
    rng = np.random.default_rng(42)
    x = rng.random((2000, input_dim)).astype(np.float32)
    y = (0.35 * x[:, 0] + 0.4 * x[:, 1] + 0.25 * x[:, 2]).clip(0, 1)
    y = y.reshape(-1, 1).astype(np.float32)

    model = EngagementNet(input_dim)
    optimizer = torch.optim.Adam(model.parameters(), lr=1e-3)
    loss_fn = nn.MSELoss()
    loader = DataLoader(TensorDataset(torch.from_numpy(x), torch.from_numpy(y)), batch_size=64, shuffle=True)

    model.train()
    for _ in range(epochs):
        for batch_x, batch_y in loader:
            optimizer.zero_grad()
            pred = model(batch_x)
            loss = loss_fn(pred, batch_y)
            loss.backward()
            optimizer.step()
    return model


def export_coreml(model: EngagementNet, output_path: Path, input_dim: int = FEATURE_DIM) -> None:
    model.eval()
    traced = torch.jit.trace(model, torch.randn(1, input_dim))
    mlmodel = ct.convert(
        traced,
        inputs=[ct.TensorType(name="features", shape=(1, input_dim))],
        outputs=[ct.TensorType(name="engagement")],
        minimum_deployment_target=ct.target.macOS11,
        convert_to="neuralnetwork",
    )
    mlmodel.save(str(output_path))
    print(f"Saved {output_path}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, default=Path("attune-app/src-tauri/models/AttuneEngagement.mlmodel"))
    parser.add_argument("--input-dim", type=int, default=FEATURE_DIM)
    args = parser.parse_args()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    model = train(args.input_dim)
    export_coreml(model, args.output, args.input_dim)


if __name__ == "__main__":
    main()

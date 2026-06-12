#!/usr/bin/env python3
"""Convert HSEmotion enet_b0_8_best_afew to AttuneAffect Core ML (224×224 face crop)."""

import argparse
import json
import os
import sys
from pathlib import Path

import coremltools as ct
import numpy as np
import torch
import torch.nn as nn

ML_DIR = Path(__file__).parent
REPO_ROOT = ML_DIR.parent
DEFAULT_OUTPUT = REPO_ROOT / "attune-app/src-tauri/models/AttuneAffect.mlmodel"
MODEL_NAME = "enet_b0_8_best_afew"
IMG_SIZE = 224

# ImageNet normalization used by HSEmotion (facial_emotions.py)
MEAN = [0.485, 0.456, 0.406]
STD = [0.229, 0.224, 0.225]


class HSEmotionExport(nn.Module):
    """End-to-end export: RGB [0,1] tensor -> 8 emotion logits."""

    def __init__(self, backbone: nn.Module):
        super().__init__()
        self.backbone = backbone
        self.register_buffer("mean", torch.tensor(MEAN).view(1, 3, 1, 1))
        self.register_buffer("std", torch.tensor(STD).view(1, 3, 1, 1))

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        x = (x - self.mean) / self.std
        return self.backbone(x)


def load_hsemotion_model(model_name: str, device: str = "cpu") -> nn.Module:
    cache_dir = os.path.join(os.path.expanduser("~"), ".hsemotion")
    os.makedirs(cache_dir, exist_ok=True)
    model_file = f"{model_name}.pt"
    fpath = os.path.join(cache_dir, model_file)
    if not os.path.isfile(fpath):
        url = (
            "https://github.com/HSE-asavchenko/face-emotion-recognition/blob/main/"
            f"models/affectnet_emotions/{model_file}?raw=true"
        )
        print(f"Downloading {model_name} from {url}")
        import urllib.request

        urllib.request.urlretrieve(url, fpath)

    try:
        import timm.models.efficientnet

        torch.serialization.add_safe_globals([timm.models.efficientnet.EfficientNet])
    except Exception:
        pass

    model = torch.load(fpath, map_location=device, weights_only=False)
    model = model.to(device).eval()
    return model


def export_coreml(model: nn.Module, output_path: Path) -> None:
    wrapper = HSEmotionExport(model)
    wrapper.eval()
    dummy = torch.randn(1, 3, IMG_SIZE, IMG_SIZE)
    traced = torch.jit.trace(wrapper, dummy)

    mlmodel = ct.convert(
        traced,
        inputs=[
            ct.ImageType(
                name="face",
                shape=(1, 3, IMG_SIZE, IMG_SIZE),
                scale=1.0 / 255.0,
                color_layout=ct.colorlayout.RGB,
            )
        ],
        outputs=[ct.TensorType(name="emotion_logits")],
        minimum_deployment_target=ct.target.macOS11,
        convert_to="neuralnetwork",
    )
    mlmodel.short_description = (
        "HSEmotion enet_b0_8_best_afew — 8-class affect logits from 224×224 face crop. "
        "Remap to Attune 5-class labels in Swift via affect_label_map.json."
    )
    output_path.parent.mkdir(parents=True, exist_ok=True)
    mlmodel.save(str(output_path))
    print(f"Saved {output_path}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--model-name", default=MODEL_NAME)
    args = parser.parse_args()

    label_map = ML_DIR / "affect_label_map.json"
    if not label_map.exists():
        print(f"Missing {label_map}", file=sys.stderr)
        sys.exit(1)

    with open(label_map) as f:
        cfg = json.load(f)
    matrix = np.asarray(cfg["remap_matrix"], dtype=np.float32)
    if matrix.shape != (5, 8):
        print(f"Expected remap_matrix shape (5, 8), got {matrix.shape}", file=sys.stderr)
        sys.exit(1)

    model = load_hsemotion_model(args.model_name)
    export_coreml(model, args.output)


if __name__ == "__main__":
    main()

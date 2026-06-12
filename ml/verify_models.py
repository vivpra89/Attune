#!/usr/bin/env python3
"""Verify Attune Core ML model I/O contracts."""

import argparse
import json
import sys
from pathlib import Path

import coremltools as ct
import numpy as np
from PIL import Image

from constants import (
    FEATURE_DIM,
    GAZE_FEATURE_DIM,
    HSEMOTION_AFFECT_INPUT,
    HSEMOTION_AFFECT_OUTPUT,
    HSEMOTION_IMG_SIZE,
    MODEL_NAMES,
)


def verify_tensor_model(
    path: Path, input_name: str, output_name: str, input_shape: tuple[int, ...]
) -> None:
    if not path.exists():
        raise FileNotFoundError(f"Missing model: {path}")

    model = ct.models.MLModel(str(path))
    spec = model.get_spec()
    input_names = [i.name for i in spec.description.input]
    output_names = [o.name for o in spec.description.output]

    if input_name not in input_names:
        raise ValueError(f"{path.name}: expected input '{input_name}', got {input_names}")
    if output_name not in output_names:
        raise ValueError(f"{path.name}: expected output '{output_name}', got {output_names}")

    features = np.random.rand(*input_shape).astype(np.float32)
    out = model.predict({input_name: features})

    if output_name not in out:
        raise ValueError(f"{path.name}: prediction missing '{output_name}', keys={list(out.keys())}")

    value = out[output_name]
    if output_name == "emotion_probs":
        flat = np.asarray(value).reshape(-1)
        if len(flat) != 5:
            raise ValueError(f"{path.name}: emotion_probs length {len(flat)}, expected 5")
    else:
        scalar = float(np.asarray(value).reshape(-1)[0])
        if not (0.0 <= scalar <= 1.0):
            raise ValueError(f"{path.name}: {output_name}={scalar} out of [0,1]")

    print(f"OK {path.name}: {input_name} {input_shape} -> {output_name}")


def remap_hsemotion_probs(hse_probs: np.ndarray, remap_matrix: np.ndarray) -> np.ndarray:
    attune = remap_matrix @ hse_probs.reshape(-1)
    total = attune.sum()
    if total > 0:
        attune = attune / total
    return attune


def verify_affect_hsemotion(path: Path, label_map_path: Path) -> None:
    if not path.exists():
        raise FileNotFoundError(f"Missing model: {path}")

    with open(label_map_path) as f:
        cfg = json.load(f)
    remap = np.asarray(cfg["remap_matrix"], dtype=np.float32)
    if remap.shape != (5, 8):
        raise ValueError(f"remap_matrix shape {remap.shape}, expected (5, 8)")

    model = ct.models.MLModel(str(path))
    spec = model.get_spec()
    input_names = [i.name for i in spec.description.input]
    output_names = [o.name for o in spec.description.output]

    if HSEMOTION_AFFECT_INPUT not in input_names:
        raise ValueError(
            f"{path.name}: expected ImageType input '{HSEMOTION_AFFECT_INPUT}', got {input_names}"
        )
    if HSEMOTION_AFFECT_OUTPUT not in output_names:
        raise ValueError(
            f"{path.name}: expected output '{HSEMOTION_AFFECT_OUTPUT}', got {output_names}"
        )

    rng = np.random.default_rng(42)
    rgb = rng.integers(0, 256, size=(HSEMOTION_IMG_SIZE, HSEMOTION_IMG_SIZE, 3), dtype=np.uint8)
    pil = Image.fromarray(rgb, mode="RGB")
    out = model.predict({HSEMOTION_AFFECT_INPUT: pil})
    logits = np.asarray(out[HSEMOTION_AFFECT_OUTPUT]).reshape(-1).astype(np.float32)
    if logits.shape[0] != 8:
        raise ValueError(f"{path.name}: expected 8 logits, got {logits.shape[0]}")

    logits = logits - logits.max()
    hse_probs = np.exp(logits)
    hse_probs = hse_probs / hse_probs.sum()
    attune_probs = remap_hsemotion_probs(hse_probs, remap)
    if attune_probs.shape[0] != 5:
        raise ValueError(f"Remapped probs length {attune_probs.shape[0]}, expected 5")
    if not np.isclose(attune_probs.sum(), 1.0, atol=0.01):
        raise ValueError(f"Remapped probs sum {attune_probs.sum():.4f}, expected ~1")

    print(
        f"OK {path.name}: {HSEMOTION_AFFECT_INPUT} "
        f"({HSEMOTION_IMG_SIZE}x{HSEMOTION_IMG_SIZE} RGB) -> {HSEMOTION_AFFECT_OUTPUT} "
        f"(8 logits, 5-class remap sum={attune_probs.sum():.3f})"
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--models-dir",
        type=Path,
        default=Path("attune-app/src-tauri/models"),
    )
    args = parser.parse_args()
    ml_dir = Path(__file__).parent
    repo_root = ml_dir.parent
    models_dir = args.models_dir if args.models_dir.is_absolute() else repo_root / args.models_dir

    verify_tensor_model(
        models_dir / f"{MODEL_NAMES['engagement']}.mlmodel",
        "features",
        "engagement",
        (1, FEATURE_DIM),
    )
    verify_affect_hsemotion(
        models_dir / f"{MODEL_NAMES['affect']}.mlmodel",
        ml_dir / "affect_label_map.json",
    )
    verify_tensor_model(
        models_dir / f"{MODEL_NAMES['gaze']}.mlmodel",
        "features",
        "gaze_away",
        (1, GAZE_FEATURE_DIM),
    )
    print("All models verified.")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"Verification failed: {exc}", file=sys.stderr)
        sys.exit(1)

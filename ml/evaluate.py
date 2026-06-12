#!/usr/bin/env python3
"""Evaluate exported Attune ML data quality metrics."""

import argparse
from pathlib import Path

import pandas as pd


def evaluate(export_dir: Path) -> None:
    ml_path = export_dir / "ml_inference_samples.parquet"
    if not ml_path.exists():
        print(f"No export found at {ml_path}. Run export_session_features.py first.")
        return

    df = pd.read_parquet(ml_path)
    print(f"ML samples: {len(df)}")
    print(f"Sessions: {df['session_id'].nunique()}")
    print(f"Model versions: {df['model_version'].value_counts().to_dict()}")
    print(f"Avg engagement: {df['engagement'].mean():.3f}")
    print(f"Avg gaze-away: {df['gaze_away'].mean():.3f}")

    dist_path = export_dir / "distraction_events.parquet"
    if dist_path.exists():
        dist = pd.read_parquet(dist_path)
        print(f"\nDistraction events: {len(dist)}")
        print(dist["kind"].value_counts().to_string())


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--export-dir", type=Path, default=Path("ml/data/export"))
    args = parser.parse_args()
    evaluate(args.export_dir)


if __name__ == "__main__":
    main()

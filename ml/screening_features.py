#!/usr/bin/env python3
"""Extract oculomotor features from screening_samples (I-VT style on coarse gaze proxies)."""

from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np
import pandas as pd

FIXATION_MIN_MS = 70.0
SACCADE_VELOCITY_THRESH = 0.08
BLINK_EYE_THRESHOLD = 25.0


def _std(values: np.ndarray) -> float:
    if len(values) < 2:
        return 0.0
    return float(np.std(values))


def compute_task_features(task_id: str, df: pd.DataFrame) -> dict:
    if df.empty:
        return {
            "task_id": task_id,
            "sample_count": 0,
            "face_present_ratio": 0.0,
            "mean_gaze_away": 0.0,
            "pct_on_screen": 0.0,
            "blink_rate_per_min": 0.0,
            "yaw_std": 0.0,
            "pitch_std": 0.0,
            "fixation_count": 0,
            "mean_fixation_duration_ms": 0.0,
            "saccade_count": 0,
            "mean_saccade_latency_ms": 0.0,
        }

    n = len(df)
    face_present_ratio = float((df["face_present"] != 0).mean())
    mean_gaze_away = float(df["gaze_away"].mean())
    pct_on_screen = float(((df["gaze_away"] < 0.45) & (df["face_present"] != 0)).mean() * 100)

    duration_sec = float(df["ts"].iloc[-1] - df["ts"].iloc[0])
    eye = df["eye_open"].values
    blink_count = sum(
        1 for i in range(1, len(eye)) if eye[i - 1] >= BLINK_EYE_THRESHOLD and eye[i] < BLINK_EYE_THRESHOLD
    )
    blink_rate = blink_count / (duration_sec / 60.0) if duration_sec > 0.1 else 0.0

    yaw_std = _std(df["yaw"].values.astype(float))
    pitch_std = _std(df["pitch"].values.astype(float))

    fixation_durations: list[float] = []
    saccade_latencies: list[float] = []
    fixation_count = 0
    saccade_count = 0

    rows = df.sort_values("ts").reset_index(drop=True)
    i = 0
    while i < len(rows):
        if rows.at[i, "face_present"] == 0:
            i += 1
            continue
        start_ts = rows.at[i, "ts"]
        j = i
        max_vel = 0.0
        while j + 1 < len(rows) and rows.at[j + 1, "face_present"] != 0:
            dt = rows.at[j + 1, "ts"] - rows.at[j, "ts"]
            if dt > 0:
                dy = rows.at[j + 1, "yaw"] - rows.at[j, "yaw"]
                dp = rows.at[j + 1, "pitch"] - rows.at[j, "pitch"]
                vel = float(np.sqrt(dy * dy + dp * dp) / dt)
                max_vel = max(max_vel, vel)
            if max_vel > SACCADE_VELOCITY_THRESH:
                break
            j += 1
        duration_ms = (rows.at[j, "ts"] - start_ts) * 1000.0
        if max_vel <= SACCADE_VELOCITY_THRESH and duration_ms >= FIXATION_MIN_MS:
            fixation_count += 1
            fixation_durations.append(duration_ms)
        elif max_vel > SACCADE_VELOCITY_THRESH:
            saccade_count += 1
            if j + 1 < len(rows):
                saccade_latencies.append((rows.at[j + 1, "ts"] - start_ts) * 1000.0)
        i = max(j + 1, i + 1)

    return {
        "task_id": task_id,
        "sample_count": n,
        "face_present_ratio": face_present_ratio,
        "mean_gaze_away": mean_gaze_away,
        "pct_on_screen": pct_on_screen,
        "blink_rate_per_min": float(blink_rate),
        "yaw_std": yaw_std,
        "pitch_std": pitch_std,
        "fixation_count": fixation_count,
        "mean_fixation_duration_ms": float(np.mean(fixation_durations)) if fixation_durations else 0.0,
        "saccade_count": saccade_count,
        "mean_saccade_latency_ms": float(np.mean(saccade_latencies)) if saccade_latencies else 0.0,
    }


def features_for_screening(samples: pd.DataFrame, trials: pd.DataFrame | None = None) -> pd.DataFrame:
    """One row per screening_id with flattened task features."""
    rows = []
    for screening_id, group in samples.groupby("screening_id"):
        row: dict = {"screening_id": screening_id}
        for task_id, task_df in group.groupby("task_id"):
            feats = compute_task_features(str(task_id), task_df)
            for k, v in feats.items():
                if k == "task_id":
                    continue
                row[f"{task_id}_{k}"] = v
        if trials is not None and not trials.empty:
            sid_trials = trials[trials["screening_id"] == screening_id]
            for task_id in ("prosaccade", "antisaccade"):
                task_trials = sid_trials[sid_trials["task_id"] == task_id]
                scored = task_trials[task_trials["scored"] != 0]
                row[f"{task_id}_trial_count"] = len(task_trials)
                row[f"{task_id}_scored_count"] = len(scored)
                row[f"{task_id}_error_count"] = int(scored["direction_error"].fillna(0).sum())
                row[f"{task_id}_error_rate"] = (
                    row[f"{task_id}_error_count"] / len(scored) if len(scored) else 0.0
                )
                lat = scored["saccade_latency_ms"].dropna()
                row[f"{task_id}_mean_latency_ms"] = float(lat.mean()) if len(lat) else 0.0
        rows.append(row)
    return pd.DataFrame(rows)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--samples",
        type=Path,
        default=Path("ml/data/export/screening_samples.parquet"),
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("ml/data/export/screening_features.parquet"),
    )
    args = parser.parse_args()
    samples = pd.read_parquet(args.samples)
    out = features_for_screening(samples)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    out.to_parquet(args.output, index=False)
    print(f"Wrote {len(out)} screening feature rows to {args.output}")


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Train screening classifier from labeled sessions; export Core ML when cohort is large enough."""

from __future__ import annotations

import argparse
import json
import sqlite3
import subprocess
import sys
from pathlib import Path

import coremltools as ct
import numpy as np
import pandas as pd
from sklearn.ensemble import ExtraTreesClassifier
from sklearn.model_selection import cross_val_score
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

from screening_features import features_for_screening

MIN_LABELED_SESSIONS = 50
MIN_CV_AUC = 0.72


def load_labeled_cohort(db_path: Path) -> tuple[pd.DataFrame, pd.Series]:
    conn = sqlite3.connect(db_path)
    samples = pd.read_sql_query(
        """
        SELECT screening_id, task_id, ts, yaw, pitch, eye_open, gaze_away, face_present, engagement
        FROM screening_samples
        ORDER BY screening_id, ts
        """,
        conn,
    )
    trials = pd.read_sql_query(
        """
        SELECT screening_id, task_id, trial_index, cue_side, expected_gaze_side,
               cue_onset_ts, scored, saccade_latency_ms, direction_error, anticipatory, gaze_direction
        FROM screening_trials
        ORDER BY screening_id, task_id, trial_index
        """,
        conn,
    )
    labels = pd.read_sql_query(
        """
        SELECT id AS screening_id, label
        FROM screening_sessions
        WHERE label IS NOT NULL
        """,
        conn,
    )
    conn.close()

    if samples.empty or labels.empty:
        return pd.DataFrame(), pd.Series(dtype=int)

    feats = features_for_screening(samples, trials if not trials.empty else None)
    merged = feats.merge(labels, on="screening_id", how="inner")
    if merged.empty:
        return pd.DataFrame(), pd.Series(dtype=int)

    y = merged["label"].astype(int)
    x = merged.drop(columns=["screening_id", "label"], errors="ignore")
    x = x.fillna(0.0)
    return x, y


def export_coreml(pipeline: Pipeline, feature_names: list[str], output: Path) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    # sklearn -> Core ML via coremltools
    mlmodel = ct.converters.sklearn.convert(
        pipeline,
        input_features=feature_names,
        output_feature_names="adhd_indicator_prob",
    )
    mlmodel.author = "Attune"
    mlmodel.short_description = "Screening aid classifier (not diagnostic)"
    mlmodel.save(str(output))
    print(f"Saved {output}")

    compiled = output.with_suffix(".mlmodelc")
    if compiled.exists():
        import shutil

        shutil.rmtree(compiled)
    subprocess.run(
        ["xcrun", "coremlcompiler", "compile", str(output), str(output.parent)],
        check=True,
    )


def set_validated_flag(db_path: Path, validated: bool) -> None:
    conn = sqlite3.connect(db_path)
    conn.execute(
        """
        INSERT OR REPLACE INTO attune_settings (key, value) VALUES
        ('screening_classifier_validated', ?)
        """,
        ("true" if validated else "false",),
    )
    conn.commit()
    conn.close()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--db",
        type=Path,
        default=Path.home() / "Library/Application Support/ai.attune.app/attune.db",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("attune-app/models/AttuneScreening.mlmodel"),
    )
    parser.add_argument("--min-sessions", type=int, default=MIN_LABELED_SESSIONS)
    args = parser.parse_args()

    x, y = load_labeled_cohort(args.db)
    n = len(y)
    metrics_path = Path("ml/data/export/screening_classifier_metrics.json")
    metrics_path.parent.mkdir(parents=True, exist_ok=True)

    if n < args.min_sessions:
        print(
            f"Only {n} labeled screenings (need {args.min_sessions}). "
            "Skipping classifier export; feature-only reports remain enabled."
        )
        set_validated_flag(args.db, False)
        metrics_path.write_text(
            json.dumps({"labeled_count": n, "validated": False, "reason": "insufficient_labels"})
        )
        sys.exit(0)

    pipeline = Pipeline(
        [
            ("scaler", StandardScaler()),
            ("clf", ExtraTreesClassifier(n_estimators=200, random_state=42)),
        ]
    )
    scores = cross_val_score(pipeline, x, y, cv=min(5, n), scoring="roc_auc")
    mean_auc = float(np.mean(scores))
    print(f"Cross-val ROC-AUC: {mean_auc:.3f} (n={n})")

    pipeline.fit(x, y)
    feature_names = list(x.columns)
    export_coreml(pipeline, feature_names, args.output)

    validated = mean_auc >= MIN_CV_AUC
    set_validated_flag(args.db, validated)
    metrics_path.write_text(
        json.dumps(
            {
                "labeled_count": n,
                "cv_auc_mean": mean_auc,
                "validated": validated,
                "feature_count": len(feature_names),
            },
            indent=2,
        )
    )
    if not validated:
        print(f"AUC {mean_auc:.3f} below threshold {MIN_CV_AUC}; classifier not enabled in app.")
    else:
        print("Classifier validated and enabled for on-device inference when bundled.")


if __name__ == "__main__":
    main()

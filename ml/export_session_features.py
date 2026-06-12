#!/usr/bin/env python3
"""Export Attune SQLite session data to Parquet for model training."""

import argparse
import json
import sqlite3
from pathlib import Path

import pandas as pd


def export_db(db_path: Path, output_dir: Path) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(db_path)

    ml_df = pd.read_sql_query(
        """
        SELECT session_id, ts, engagement, gaze_away, emotion_json, model_version
        FROM ml_inference_samples
        ORDER BY session_id, ts
        """,
        conn,
    )
    ml_df.to_parquet(output_dir / "ml_inference_samples.parquet", index=False)

    dist_df = pd.read_sql_query(
        """
        SELECT session_id, ts, kind, severity, confidence, app_bundle_id, metadata_json
        FROM distraction_events
        ORDER BY session_id, ts
        """,
        conn,
    )
    dist_df.to_parquet(output_dir / "distraction_events.parquet", index=False)

    feedback_df = pd.read_sql_query(
        """
        SELECT session_id, ts, event_kind, helpful
        FROM distraction_feedback
        ORDER BY session_id, ts
        """,
        conn,
    )
    feedback_df.to_parquet(output_dir / "distraction_feedback.parquet", index=False)

    attention_df = pd.read_sql_query(
        """
        SELECT session_id, ts, score, smoothed_score, effective_score,
               opacity, feedback_state, emotion
        FROM attention_samples
        ORDER BY session_id, ts
        """,
        conn,
    )
    attention_df.to_parquet(output_dir / "attention_samples.parquet", index=False)

    screening_df = pd.DataFrame()
    screening_labels = pd.DataFrame()
    try:
        screening_df = pd.read_sql_query(
            """
            SELECT screening_id, task_id, ts, yaw, pitch, eye_open, gaze_away,
                   face_present, face_quality, engagement
            FROM screening_samples
            ORDER BY screening_id, ts
            """,
            conn,
        )
        screening_df.to_parquet(output_dir / "screening_samples.parquet", index=False)
        screening_labels = pd.read_sql_query(
            """
            SELECT id AS screening_id, started_at, ended_at, label, label_source
            FROM screening_sessions
            ORDER BY started_at DESC
            """,
            conn,
        )
        screening_labels.to_parquet(output_dir / "screening_sessions.parquet", index=False)
    except Exception:
        pass

    conn.close()
    print(
        f"Exported {len(ml_df)} ML samples, {len(dist_df)} distraction events, "
        f"{len(screening_df)} screening samples to {output_dir}"
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="Export Attune SQLite to Parquet")
    parser.add_argument(
        "--db",
        type=Path,
        default=Path.home() / "Library/Application Support/ai.attune.app/attune.db",
        help="Path to attune.db",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("ml/data/export"),
        help="Output directory for Parquet files",
    )
    args = parser.parse_args()
    export_db(args.db, args.output)


if __name__ == "__main__":
    main()

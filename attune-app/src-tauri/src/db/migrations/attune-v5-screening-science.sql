-- Science-based screening: trial events, summaries, baseline calibration

CREATE TABLE IF NOT EXISTS screening_trials (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    screening_id TEXT NOT NULL,
    task_id TEXT NOT NULL,
    trial_index INTEGER NOT NULL,
    cue_side TEXT NOT NULL,
    expected_gaze_side TEXT NOT NULL,
    cue_onset_ts REAL NOT NULL,
    scored INTEGER NOT NULL DEFAULT 0,
    saccade_latency_ms REAL,
    direction_error INTEGER,
    anticipatory INTEGER NOT NULL DEFAULT 0,
    gaze_direction TEXT,
    FOREIGN KEY (screening_id) REFERENCES screening_sessions(id)
);

CREATE INDEX IF NOT EXISTS idx_screening_trials_screening
    ON screening_trials(screening_id, task_id, trial_index);

-- Adaptive Train mode: sessions, runs, events, compliance, gaze samples

CREATE TABLE IF NOT EXISTS training_sessions (
    id TEXT PRIMARY KEY,
    child_profile_id TEXT NOT NULL DEFAULT 'default',
    started_at INTEGER NOT NULL,
    ended_at INTEGER,
    mission_minutes REAL NOT NULL DEFAULT 0,
    world_id INTEGER NOT NULL DEFAULT 1,
    summary_json TEXT,
    steer_accuracy REAL,
    tap_accuracy REAL,
    multitask_cost REAL,
    gaze_engagement REAL,
    mean_rt_ms REAL
);

CREATE INDEX IF NOT EXISTS idx_training_sessions_started
    ON training_sessions(started_at DESC);

CREATE TABLE IF NOT EXISTS training_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    run_index INTEGER NOT NULL,
    phase TEXT NOT NULL,
    started_at REAL NOT NULL,
    ended_at REAL,
    steer_accuracy REAL,
    tap_accuracy REAL,
    multitask_cost REAL,
    mean_rt_ms REAL,
    gaze_engagement REAL,
    difficulty_json TEXT NOT NULL,
    FOREIGN KEY (session_id) REFERENCES training_sessions(id)
);

CREATE INDEX IF NOT EXISTS idx_training_runs_session
    ON training_runs(session_id, run_index);

CREATE TABLE IF NOT EXISTS training_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    run_index INTEGER NOT NULL,
    ts REAL NOT NULL,
    event_type TEXT NOT NULL,
    correct INTEGER,
    rt_ms REAL,
    FOREIGN KEY (session_id) REFERENCES training_sessions(id)
);

CREATE INDEX IF NOT EXISTS idx_training_events_session
    ON training_events(session_id, run_index);

CREATE TABLE IF NOT EXISTS training_daily_compliance (
    date TEXT PRIMARY KEY,
    minutes_played REAL NOT NULL DEFAULT 0,
    missions_completed INTEGER NOT NULL DEFAULT 0,
    locked_out INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS training_gaze_samples (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    ts REAL NOT NULL,
    gaze_away REAL NOT NULL,
    engagement REAL NOT NULL,
    face_present INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (session_id) REFERENCES training_sessions(id)
);

CREATE INDEX IF NOT EXISTS idx_training_gaze_session
    ON training_gaze_samples(session_id);

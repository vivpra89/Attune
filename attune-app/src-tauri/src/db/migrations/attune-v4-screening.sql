-- ADHD attention screening (non-diagnostic): structured tasks + high-rate samples

CREATE TABLE IF NOT EXISTS screening_sessions (
    id TEXT PRIMARY KEY NOT NULL,
    started_at INTEGER NOT NULL,
    ended_at INTEGER,
    child_profile_id TEXT DEFAULT 'default',
    report_json TEXT,
    label INTEGER,
    label_source TEXT
);

CREATE INDEX IF NOT EXISTS idx_screening_sessions_started ON screening_sessions(started_at DESC);

CREATE TABLE IF NOT EXISTS screening_samples (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    screening_id TEXT NOT NULL,
    task_id TEXT NOT NULL,
    ts REAL NOT NULL,
    yaw REAL NOT NULL DEFAULT 0,
    pitch REAL NOT NULL DEFAULT 0,
    eye_open REAL NOT NULL DEFAULT 0,
    gaze_away REAL NOT NULL DEFAULT 0,
    face_present INTEGER NOT NULL DEFAULT 0,
    face_quality REAL NOT NULL DEFAULT 0,
    engagement REAL NOT NULL DEFAULT 0,
    FOREIGN KEY (screening_id) REFERENCES screening_sessions(id)
);

CREATE INDEX IF NOT EXISTS idx_screening_samples_screening ON screening_samples(screening_id, task_id, ts);

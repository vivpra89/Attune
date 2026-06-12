-- ML inference samples and distraction events
CREATE TABLE IF NOT EXISTS ml_inference_samples (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    ts INTEGER NOT NULL,
    engagement REAL NOT NULL,
    gaze_away REAL NOT NULL,
    emotion_json TEXT NOT NULL,
    model_version TEXT NOT NULL,
    FOREIGN KEY (session_id) REFERENCES sessions(id)
);

CREATE INDEX IF NOT EXISTS idx_ml_inference_session ON ml_inference_samples(session_id, ts);

CREATE TABLE IF NOT EXISTS distraction_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    ts INTEGER NOT NULL,
    kind TEXT NOT NULL,
    severity REAL NOT NULL,
    confidence REAL NOT NULL,
    app_bundle_id TEXT,
    metadata_json TEXT,
    FOREIGN KEY (session_id) REFERENCES sessions(id)
);

CREATE INDEX IF NOT EXISTS idx_distraction_session ON distraction_events(session_id, ts);

CREATE TABLE IF NOT EXISTS child_profiles (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    focus_apps_json TEXT NOT NULL DEFAULT '[]',
    created_at INTEGER NOT NULL
);

INSERT OR IGNORE INTO child_profiles (id, name, focus_apps_json, created_at)
VALUES ('default', 'Child', '[]', strftime('%s', 'now'));

CREATE TABLE IF NOT EXISTS distraction_feedback (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    ts INTEGER NOT NULL,
    event_kind TEXT NOT NULL,
    helpful INTEGER NOT NULL,
    FOREIGN KEY (session_id) REFERENCES sessions(id)
);

INSERT OR IGNORE INTO attune_settings (key, value) VALUES ('focus_apps', '[]');
INSERT OR IGNORE INTO attune_settings (key, value) VALUES ('improve_attune', 'false');
INSERT OR IGNORE INTO attune_settings (key, value) VALUES ('model_version', 'heuristic-v0.1');

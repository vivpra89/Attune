-- Attune session tracking tables
CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY NOT NULL,
    started_at INTEGER NOT NULL,
    ended_at INTEGER,
    summary_text TEXT,
    child_profile_id TEXT DEFAULT 'default'
);

CREATE TABLE IF NOT EXISTS attention_samples (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    ts INTEGER NOT NULL,
    score REAL NOT NULL,
    FOREIGN KEY (session_id) REFERENCES sessions(id)
);

CREATE INDEX IF NOT EXISTS idx_attention_samples_session ON attention_samples(session_id, ts);

CREATE TABLE IF NOT EXISTS app_focus_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    ts INTEGER NOT NULL,
    bundle_id TEXT NOT NULL,
    app_name TEXT NOT NULL,
    duration_sec INTEGER NOT NULL DEFAULT 1,
    FOREIGN KEY (session_id) REFERENCES sessions(id)
);

CREATE INDEX IF NOT EXISTS idx_app_focus_session ON app_focus_events(session_id, ts);

CREATE TABLE IF NOT EXISTS weekly_reports (
    id TEXT PRIMARY KEY NOT NULL,
    week_start INTEGER NOT NULL,
    report_json TEXT NOT NULL,
    created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS attune_settings (
    key TEXT PRIMARY KEY NOT NULL,
    value TEXT NOT NULL
);

INSERT OR IGNORE INTO attune_settings (key, value) VALUES ('dim_sensitivity', '70');
INSERT OR IGNORE INTO attune_settings (key, value) VALUES ('child_name', 'Child');
INSERT OR IGNORE INTO attune_settings (key, value) VALUES ('feedback_profile', 'gentle');

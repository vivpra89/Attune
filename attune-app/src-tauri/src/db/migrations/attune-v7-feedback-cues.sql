-- Feedback cue event log and parent audio settings
CREATE TABLE IF NOT EXISTS feedback_cue_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    ts INTEGER NOT NULL,
    cue TEXT NOT NULL,
    volume REAL NOT NULL,
    feedback_state TEXT NOT NULL,
    FOREIGN KEY (session_id) REFERENCES sessions(id)
);

CREATE INDEX IF NOT EXISTS idx_feedback_cue_session ON feedback_cue_events(session_id, ts);

INSERT OR IGNORE INTO attune_settings (key, value) VALUES ('audio_cues', 'true');
INSERT OR IGNORE INTO attune_settings (key, value) VALUES ('cue_volume', '70');
INSERT OR IGNORE INTO attune_settings (key, value) VALUES ('refocus_chime', 'false');

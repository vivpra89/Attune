use rusqlite::Connection;
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

pub struct AttuneDb(pub Mutex<Connection>);

pub fn init_db(app: &AppHandle) -> Result<(), String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {e}"))?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("Failed to create app data dir: {e}"))?;
    let db_path = dir.join("attune.db");
    let conn = Connection::open(&db_path).map_err(|e| format!("Failed to open database: {e}"))?;
    conn.execute_batch(include_str!("db/migrations/attune-sessions.sql"))
        .map_err(|e| format!("Failed to run migrations: {e}"))?;
    run_feedback_migrations(&conn)?;
    run_cue_migrations(&conn)?;
    run_screening_migrations(&conn)?;
    run_training_migrations(&conn)?;
    app.manage(AttuneDb(Mutex::new(conn)));
    Ok(())
}

fn run_feedback_migrations(conn: &Connection) -> Result<(), String> {
    let alters = [
        "ALTER TABLE attention_samples ADD COLUMN smoothed_score REAL",
        "ALTER TABLE attention_samples ADD COLUMN effective_score REAL",
        "ALTER TABLE attention_samples ADD COLUMN opacity REAL",
        "ALTER TABLE attention_samples ADD COLUMN feedback_state TEXT",
        "ALTER TABLE attention_samples ADD COLUMN emotion TEXT",
    ];
    for sql in alters {
        let _ = conn.execute(sql, []);
    }
    let _ = conn.execute(
        "INSERT OR IGNORE INTO attune_settings (key, value) VALUES ('feedback_profile', 'gentle')",
        [],
    );
    Ok(())
}

fn run_cue_migrations(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(include_str!("db/migrations/attune-v7-feedback-cues.sql"))
        .map_err(|e| format!("Failed to run cue migrations: {e}"))?;
    Ok(())
}

fn run_screening_migrations(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(include_str!("db/migrations/attune-v4-screening.sql"))
        .map_err(|e| format!("Failed to run screening migrations: {e}"))?;
    conn.execute_batch(include_str!("db/migrations/attune-v5-screening-science.sql"))
        .map_err(|e| format!("Failed to run screening v5 migrations: {e}"))?;
    let _ = conn.execute(
        "ALTER TABLE screening_sessions ADD COLUMN summary_text TEXT",
        [],
    );
    Ok(())
}

fn run_training_migrations(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(include_str!("db/migrations/attune-v6-training.sql"))
        .map_err(|e| format!("Failed to run training migrations: {e}"))?;
    let _ = conn.execute(
        "INSERT OR IGNORE INTO attune_settings (key, value) VALUES ('training_daily_minutes', '25')",
        [],
    );
    Ok(())
}

pub fn with_db<T, F: FnOnce(&Connection) -> Result<T, String>>(
    app: &AppHandle,
    f: F,
) -> Result<T, String> {
    let state = app.state::<AttuneDb>();
    let guard = state
        .0
        .lock()
        .map_err(|_| "Database lock poisoned".to_string())?;
    f(&guard)
}
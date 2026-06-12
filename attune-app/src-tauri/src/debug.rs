use crate::distraction::DistractionState;
use crate::feedback::FeedbackUpdate;
use crate::vision::AttentionSample;
use serde::Serialize;
use tauri::AppHandle;

use crate::attune_db::with_db;

#[derive(Debug, Clone, Serialize)]
pub struct SessionDebugTick {
    pub ts: i64,
    pub session_id: String,
    pub vision: AttentionSample,
    pub app_name: Option<String>,
    pub app_bundle: Option<String>,
    pub distraction: DistractionState,
    pub feedback: FeedbackUpdate,
}

pub fn load_debug_mode(app: &AppHandle) -> bool {
    if cfg!(debug_assertions) {
        return true;
    }
    with_db(app, |conn| {
        let mut stmt = conn
            .prepare("SELECT value FROM attune_settings WHERE key = 'debug_mode'")
            .map_err(|e| e.to_string())?;
        let mut rows = stmt.query([]).map_err(|e| e.to_string())?;
        if let Some(row) = rows.next().map_err(|e| e.to_string())? {
            let v: String = row.get(0).map_err(|e| e.to_string())?;
            return Ok(v == "true");
        }
        Ok(false)
    })
    .unwrap_or(false)
}

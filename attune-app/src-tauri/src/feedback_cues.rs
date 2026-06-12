use crate::attune_db::with_db;
use crate::feedback::{FeedbackState, FeedbackUpdate};
use tauri::{AppHandle, Emitter};

const CUE_DEBOUNCE_SECS: f64 = 8.0;

pub fn load_audio_cues_enabled(app: &AppHandle) -> bool {
    with_db(app, |conn| {
        let mut stmt = conn
            .prepare("SELECT value FROM attune_settings WHERE key = 'audio_cues'")
            .map_err(|e| e.to_string())?;
        let mut rows = stmt.query([]).map_err(|e| e.to_string())?;
        if let Some(row) = rows.next().map_err(|e| e.to_string())? {
            let v: String = row.get(0).map_err(|e| e.to_string())?;
            return Ok(v != "false");
        }
        Ok(true)
    })
    .unwrap_or(true)
}

pub fn handle_feedback_transition(
    app: &AppHandle,
    prev_state: Option<FeedbackState>,
    update: &FeedbackUpdate,
    now: f64,
) {
    if !load_audio_cues_enabled(app) {
        return;
    }

    // Visual-only when back to focused ("Here") — no chime on recovery.
    if update.state == FeedbackState::Focused || update.show_reengage {
        return;
    }

    let Some(prev) = prev_state else {
        return;
    };

    if prev == update.state {
        return;
    }

    // Chime only when entering dimmed — not soft nudge, confusion help, or break.
    if update.state != FeedbackState::Dimmed || prev == FeedbackState::Dimmed {
        return;
    }

    emit_cue(app, "dim", now);
}

fn emit_cue(app: &AppHandle, cue: &str, now: f64) {
    use std::sync::Mutex;
    use std::time::{SystemTime, UNIX_EPOCH};

    static LAST_CUE: Mutex<Option<(String, f64)>> = Mutex::new(None);

    let ts = if now > 0.0 {
        now
    } else {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs_f64())
            .unwrap_or(0.0)
    };

    {
        let mut guard = LAST_CUE.lock().unwrap();
        if let Some((ref last_name, last_ts)) = *guard {
            if last_name == cue && ts - last_ts < CUE_DEBOUNCE_SECS {
                return;
            }
        }
        *guard = Some((cue.to_string(), ts));
    }

    let _ = app.emit("play-feedback-cue", cue);
}

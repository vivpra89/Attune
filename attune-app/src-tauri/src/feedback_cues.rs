use crate::attune_db::with_db;
use crate::feedback::{FeedbackState, FeedbackUpdate};
use serde::Serialize;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter};

const MIN_CUE_GAP_SECS: f64 = 3.0;

#[derive(Debug, Clone, Serialize)]
pub struct FeedbackCueEvent {
    pub cue: String,
    pub volume: f32,
}

struct CueScheduler {
    last_cue_at: f64,
    last_state: Option<FeedbackState>,
}

static SCHEDULER: Mutex<CueScheduler> = Mutex::new(CueScheduler {
    last_cue_at: -MIN_CUE_GAP_SECS,
    last_state: None,
});

pub fn reset_cue_scheduler() {
    if let Ok(mut guard) = SCHEDULER.lock() {
        guard.last_cue_at = -MIN_CUE_GAP_SECS;
        guard.last_state = None;
    }
}

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

/// Duration-based escalating audio cues during active sessions.
pub fn handle_feedback_cues(app: &AppHandle, update: &FeedbackUpdate, now: f64, profile_name: &str) {
    if !load_audio_cues_enabled(app) {
        return;
    }

    if update.state == FeedbackState::Focused
        || update.show_reengage
        || update.state == FeedbackState::ConfusionHelp
        || update.state == FeedbackState::HyperfocusRedirect
    {
        if let Ok(mut guard) = SCHEDULER.lock() {
            guard.last_state = Some(update.state);
        }
        return;
    }

    let Some((cue, volume)) = cue_for_state(update.state) else {
        return;
    };

    let mut guard = match SCHEDULER.lock() {
        Ok(g) => g,
        Err(_) => return,
    };

    let state_changed = guard.last_state != Some(update.state);
    guard.last_state = Some(update.state);

    let interval = profile_scale(
        repeat_interval_secs(update.state, update.state_duration_secs, profile_name),
        profile_name,
    );

    let should_play = if state_changed {
        true
    } else if now - guard.last_cue_at >= interval {
        true
    } else {
        false
    };

    if !should_play {
        return;
    }

    if !state_changed && now - guard.last_cue_at < MIN_CUE_GAP_SECS {
        return;
    }

    guard.last_cue_at = now;
    drop(guard);

    let _ = app.emit(
        "play-feedback-cue",
        FeedbackCueEvent {
            cue: cue.to_string(),
            volume,
        },
    );
}

fn cue_for_state(state: FeedbackState) -> Option<(&'static str, f32)> {
    match state {
        FeedbackState::SoftNudge => Some(("nudge", 0.35)),
        FeedbackState::Dimmed => Some(("dim", 0.45)),
        FeedbackState::BreakSuggest => Some(("dim", 0.30)),
        _ => None,
    }
}

fn profile_scale(interval: f64, profile_name: &str) -> f64 {
    match profile_name {
        "gentle" => interval * 1.25,
        "strong" => interval * 0.85,
        _ => interval,
    }
}

/// Base repeat interval before profile scaling (seconds).
fn repeat_interval_secs(
    state: FeedbackState,
    state_duration_secs: f32,
    profile_name: &str,
) -> f64 {
    match state {
        FeedbackState::SoftNudge => match profile_name {
            "strong" => 8.0,
            "standard" => 10.0,
            _ => 12.0,
        },
        FeedbackState::Dimmed => {
            if state_duration_secs >= 30.0 {
                3.0
            } else if state_duration_secs >= 15.0 {
                5.0
            } else {
                8.0
            }
        }
        FeedbackState::BreakSuggest => 14.0,
        _ => f64::MAX,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dim_interval_escalates_with_duration() {
        assert_eq!(
            repeat_interval_secs(FeedbackState::Dimmed, 5.0, "standard"),
            8.0
        );
        assert_eq!(
            repeat_interval_secs(FeedbackState::Dimmed, 20.0, "standard"),
            5.0
        );
        assert_eq!(
            repeat_interval_secs(FeedbackState::Dimmed, 35.0, "standard"),
            3.0
        );
    }

    #[test]
    fn profile_scale_adjusts_interval() {
        assert_eq!(profile_scale(10.0, "gentle"), 12.5);
        assert_eq!(profile_scale(10.0, "strong"), 8.5);
        assert_eq!(profile_scale(10.0, "standard"), 10.0);
    }

    #[test]
    fn cue_mapping_for_nudge_and_dim() {
        assert_eq!(
            cue_for_state(FeedbackState::SoftNudge),
            Some(("nudge", 0.35))
        );
        assert_eq!(cue_for_state(FeedbackState::Dimmed), Some(("dim", 0.45)));
        assert_eq!(
            cue_for_state(FeedbackState::BreakSuggest),
            Some(("dim", 0.30))
        );
        assert_eq!(cue_for_state(FeedbackState::Focused), None);
        assert_eq!(cue_for_state(FeedbackState::ConfusionHelp), None);
    }

    #[test]
    fn soft_nudge_base_intervals() {
        assert_eq!(
            repeat_interval_secs(FeedbackState::SoftNudge, 0.0, "gentle"),
            12.0
        );
        assert_eq!(
            repeat_interval_secs(FeedbackState::SoftNudge, 0.0, "strong"),
            8.0
        );
    }
}

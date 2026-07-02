use crate::attune_db::with_db;
use crate::feedback::{FeedbackState, FeedbackUpdate};
use serde::Serialize;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter};

const MIN_CUE_GAP_SECS: f64 = 3.0;
const REENGAGE_CUE_GAP_SECS: f64 = 8.0;

#[derive(Debug, Clone)]
pub struct CueConfig {
    pub audio_cues_enabled: bool,
    /// Parent volume multiplier 0.0–1.0 (from settings slider 0–100).
    pub cue_volume: f32,
    pub refocus_chime_enabled: bool,
}

impl Default for CueConfig {
    fn default() -> Self {
        Self {
            audio_cues_enabled: true,
            cue_volume: 0.7,
            refocus_chime_enabled: false,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct FeedbackCueEvent {
    pub cue: String,
    pub volume: f32,
}

struct CueScheduler {
    last_cue_at: f64,
    last_reengage_at: f64,
    last_state: Option<FeedbackState>,
}

static SCHEDULER: Mutex<CueScheduler> = Mutex::new(CueScheduler {
    last_cue_at: -MIN_CUE_GAP_SECS,
    last_reengage_at: -REENGAGE_CUE_GAP_SECS,
    last_state: None,
});

pub fn reset_cue_scheduler() {
    if let Ok(mut guard) = SCHEDULER.lock() {
        guard.last_cue_at = -MIN_CUE_GAP_SECS;
        guard.last_reengage_at = -REENGAGE_CUE_GAP_SECS;
        guard.last_state = None;
    }
}

pub fn load_cue_config(app: &AppHandle) -> CueConfig {
    with_db(app, |conn| {
        let mut cfg = CueConfig::default();
        let mut stmt = conn
            .prepare("SELECT key, value FROM attune_settings WHERE key IN ('audio_cues', 'cue_volume', 'refocus_chime')")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })
            .map_err(|e| e.to_string())?;
        for row in rows {
            let (key, value) = row.map_err(|e| e.to_string())?;
            match key.as_str() {
                "audio_cues" => cfg.audio_cues_enabled = value != "false",
                "cue_volume" => {
                    cfg.cue_volume = value
                        .parse::<f32>()
                        .unwrap_or(70.0)
                        .clamp(0.0, 100.0)
                        / 100.0;
                }
                "refocus_chime" => cfg.refocus_chime_enabled = value == "true",
                _ => {}
            }
        }
        Ok(cfg)
    })
    .unwrap_or_default()
}

/// Duration-based escalating audio cues during active sessions.
/// Returns the cue that was emitted, if any.
pub fn handle_feedback_cues(
    app: &AppHandle,
    update: &FeedbackUpdate,
    now: f64,
    profile_name: &str,
    config: &CueConfig,
) -> Option<FeedbackCueEvent> {
    if !config.audio_cues_enabled {
        return None;
    }

    if update.show_reengage && config.refocus_chime_enabled {
        return play_reengage_cue(app, now, config.cue_volume);
    }

    if update.state == FeedbackState::Focused
        || update.state == FeedbackState::ConfusionHelp
        || update.state == FeedbackState::HyperfocusRedirect
    {
        if let Ok(mut guard) = SCHEDULER.lock() {
            guard.last_state = Some(update.state);
        }
        return None;
    }

    let Some((cue, base_volume)) = cue_for_state(update.state) else {
        return None;
    };

    let volume = escalated_volume(base_volume, update.state_duration_secs, config.cue_volume);

    let mut guard = match SCHEDULER.lock() {
        Ok(g) => g,
        Err(_) => return None,
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
        return None;
    }

    if !state_changed && now - guard.last_cue_at < MIN_CUE_GAP_SECS {
        return None;
    }

    guard.last_cue_at = now;
    drop(guard);

    let event = FeedbackCueEvent {
        cue: cue.to_string(),
        volume,
    };
    let _ = app.emit("play-feedback-cue", &event);
    Some(event)
}

fn play_reengage_cue(app: &AppHandle, now: f64, cue_volume: f32) -> Option<FeedbackCueEvent> {
    let mut guard = SCHEDULER.lock().ok()?;
    if now - guard.last_reengage_at < REENGAGE_CUE_GAP_SECS {
        return None;
    }
    guard.last_reengage_at = now;
    drop(guard);

    let event = FeedbackCueEvent {
        cue: "reengage".to_string(),
        volume: (0.28 * cue_volume).clamp(0.05, 0.4),
    };
    let _ = app.emit("play-feedback-cue", &event);
    Some(event)
}

fn cue_for_state(state: FeedbackState) -> Option<(&'static str, f32)> {
    match state {
        FeedbackState::SoftNudge => Some(("nudge", 0.30)),
        FeedbackState::Dimmed => Some(("dim", 0.40)),
        FeedbackState::BreakSuggest => Some(("break", 0.30)),
        _ => None,
    }
}

/// Ramp volume as disengagement persists (capped for a supportive tone).
pub fn escalated_volume(base: f32, state_duration_secs: f32, cue_volume: f32) -> f32 {
    let boost = if state_duration_secs >= 30.0 {
        0.15
    } else if state_duration_secs >= 15.0 {
        0.08
    } else {
        0.0
    };
    ((base + boost) * cue_volume).clamp(0.05, 0.55)
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
    fn cue_mapping_for_nudge_dim_and_break() {
        assert_eq!(
            cue_for_state(FeedbackState::SoftNudge),
            Some(("nudge", 0.30))
        );
        assert_eq!(cue_for_state(FeedbackState::Dimmed), Some(("dim", 0.40)));
        assert_eq!(
            cue_for_state(FeedbackState::BreakSuggest),
            Some(("break", 0.30))
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

    #[test]
    fn escalated_volume_ramps_with_duration() {
        let early = escalated_volume(0.30, 5.0, 0.7);
        let mid = escalated_volume(0.30, 20.0, 0.7);
        let late = escalated_volume(0.30, 35.0, 0.7);
        assert!(mid > early);
        assert!(late > mid);
        assert!(late <= 0.55);
    }

    #[test]
    fn escalated_volume_respects_parent_multiplier() {
        let loud = escalated_volume(0.40, 0.0, 1.0);
        let quiet = escalated_volume(0.40, 0.0, 0.3);
        assert!(loud > quiet);
    }

    #[test]
    fn scheduler_plays_on_state_change_then_respects_interval() {
        reset_cue_scheduler();
        let config = CueConfig {
            audio_cues_enabled: true,
            cue_volume: 0.7,
            refocus_chime_enabled: false,
        };

        let mut now = 0.0;
        let update = FeedbackUpdate {
            state: FeedbackState::SoftNudge,
            opacity: 0.2,
            smoothed_score: 50.0,
            effective_score: 50.0,
            emotion: "neutral".to_string(),
            child_message: String::new(),
            show_reengage: false,
            show_break_prompt: false,
            show_confusion_help: false,
            primary_distraction: None,
            face_missing_secs: 0.0,
            state_duration_secs: 0.0,
        };

        assert!(should_play_disengagement_cue(&update, now, "gentle", true));
        record_disengagement_cue(now);

        now += 5.0;
        assert!(!should_play_disengagement_cue(
            &update,
            now,
            "gentle",
            false
        ));

        now += 8.0;
        assert!(should_play_disengagement_cue(
            &update,
            now,
            "gentle",
            false
        ));
        let _ = config;
    }

    fn should_play_disengagement_cue(
        update: &FeedbackUpdate,
        now: f64,
        profile_name: &str,
        state_changed: bool,
    ) -> bool {
        let interval = profile_scale(
            repeat_interval_secs(update.state, update.state_duration_secs, profile_name),
            profile_name,
        );
        let guard = SCHEDULER.lock().unwrap();
        if state_changed {
            return true;
        }
        now - guard.last_cue_at >= interval
    }

    fn record_disengagement_cue(now: f64) {
        let mut guard = SCHEDULER.lock().unwrap();
        guard.last_cue_at = now;
        guard.last_state = Some(FeedbackState::SoftNudge);
    }
}

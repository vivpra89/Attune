use crate::attune_api::{generate_session_summary, generate_weekly_report};
use crate::attune_db::with_db;
use crate::attention_overlay::{set_dim_opacity, start_attention_overlay, stop_attention_overlay};
use crate::debug::{load_debug_mode, SessionDebugTick};
use crate::debug_overlay::{start_debug_overlay, stop_debug_overlay};
use crate::distraction::DistractionFusionEngine;
use crate::feedback::{FeedbackEngine, FeedbackProfile};
use crate::feedback_cues;
use crate::vision::{get_frontmost_app, latest_sample, start_vision, stop_vision};
use tauri::Emitter;
use chrono::{Datelike, Duration, TimeZone, Utc};
use rusqlite::params;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use tauri::{AppHandle, Manager};
use tokio::task::JoinHandle;
use uuid::Uuid;

pub struct SessionState {
    pub active_session_id: Mutex<Option<String>>,
    pub recorder_task: Mutex<Option<JoinHandle<()>>>,
    pub sensitivity: Mutex<f32>,
    pub feedback_engine: Mutex<Option<FeedbackEngine>>,
    pub distraction_engine: Mutex<Option<DistractionFusionEngine>>,
    pub debug_enabled: AtomicBool,
}

impl Default for SessionState {
    fn default() -> Self {
        Self {
            active_session_id: Mutex::new(None),
            recorder_task: Mutex::new(None),
            sensitivity: Mutex::new(70.0),
            feedback_engine: Mutex::new(None),
            distraction_engine: Mutex::new(None),
            debug_enabled: AtomicBool::new(false),
        }
    }
}

#[derive(Serialize, Deserialize, Clone)]
pub struct SessionSummary {
    pub id: String,
    pub started_at: i64,
    pub ended_at: Option<i64>,
    pub summary_text: Option<String>,
    pub child_profile_id: String,
    pub avg_score: Option<f32>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct AttentionPoint {
    pub ts: i64,
    pub score: f32,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct DistractionPoint {
    pub ts: i64,
    pub kind: String,
    pub severity: f32,
    pub confidence: f32,
    pub app_bundle_id: Option<String>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct SessionTimeline {
    pub scores: Vec<AttentionPoint>,
    pub apps: Vec<AppFocusPoint>,
    pub distractions: Vec<DistractionPoint>,
}

fn load_focus_apps(app: &AppHandle) -> Vec<String> {
    with_db(app, |conn| {
        let mut stmt = conn
            .prepare("SELECT value FROM attune_settings WHERE key = 'focus_apps'")
            .map_err(|e| e.to_string())?;
        let mut rows = stmt.query([]).map_err(|e| e.to_string())?;
        if let Some(row) = rows.next().map_err(|e| e.to_string())? {
            let v: String = row.get(0).map_err(|e| e.to_string())?;
            if let Ok(apps) = serde_json::from_str::<Vec<String>>(&v) {
                return Ok(apps);
            }
        }
        Ok(Vec::new())
    })
    .unwrap_or_default()
}

#[derive(Serialize, Deserialize, Clone)]
pub struct AppFocusPoint {
    pub ts: i64,
    pub app_name: String,
    pub bundle_id: String,
    pub duration_sec: i64,
}

fn load_feedback_profile_name(app: &AppHandle) -> String {
    with_db(app, |conn| {
        let mut stmt = conn
            .prepare("SELECT value FROM attune_settings WHERE key = 'feedback_profile'")
            .map_err(|e| e.to_string())?;
        let mut rows = stmt.query([]).map_err(|e| e.to_string())?;
        if let Some(row) = rows.next().map_err(|e| e.to_string())? {
            let v: String = row.get(0).map_err(|e| e.to_string())?;
            return Ok(v);
        }
        Ok("gentle".to_string())
    })
    .unwrap_or_else(|_| "gentle".to_string())
}

fn load_feedback_profile(app: &AppHandle) -> FeedbackProfile {
    FeedbackProfile::from_name(&load_feedback_profile_name(app))
}

fn load_sensitivity(app: &AppHandle) -> f32 {
    with_db(app, |conn| {
        let mut stmt = conn
            .prepare("SELECT value FROM attune_settings WHERE key = 'dim_sensitivity'")
            .map_err(|e| e.to_string())?;
        let mut rows = stmt
            .query([])
            .map_err(|e| e.to_string())?;
        if let Some(row) = rows.next().map_err(|e| e.to_string())? {
            let v: String = row.get(0).map_err(|e| e.to_string())?;
            return Ok(v.parse().unwrap_or(70.0));
        }
        Ok(70.0)
    })
    .unwrap_or(70.0)
}

fn hash_pin(pin: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(pin.as_bytes());
    hex::encode(hasher.finalize())
}

#[tauri::command]
pub async fn set_parent_pin(app: AppHandle, pin: String) -> Result<(), String> {
    if pin.len() < 4 {
        return Err("PIN must be at least 4 digits".to_string());
    }
    let hashed = hash_pin(&pin);
    with_db(&app, |conn| {
        conn.execute(
            "INSERT OR REPLACE INTO attune_settings (key, value) VALUES ('parent_pin_hash', ?1)",
            params![hashed],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    })
}

#[tauri::command]
pub async fn verify_parent_pin(app: AppHandle, pin: String) -> Result<bool, String> {
    with_db(&app, |conn| {
        let mut stmt = conn
            .prepare("SELECT value FROM attune_settings WHERE key = 'parent_pin_hash'")
            .map_err(|e| e.to_string())?;
        let mut rows = stmt.query([]).map_err(|e| e.to_string())?;
        let Some(row) = rows.next().map_err(|e| e.to_string())? else {
            return Ok(true);
        };
        let stored: String = row.get(0).map_err(|e| e.to_string())?;
        Ok(stored == hash_pin(&pin))
    })
}

#[tauri::command]
pub async fn has_parent_pin(app: AppHandle) -> Result<bool, String> {
    with_db(&app, |conn| {
        let mut stmt = conn
            .prepare("SELECT 1 FROM attune_settings WHERE key = 'parent_pin_hash' LIMIT 1")
            .map_err(|e| e.to_string())?;
        let mut rows = stmt.query([]).map_err(|e| e.to_string())?;
        Ok(rows.next().map_err(|e| e.to_string())?.is_some())
    })
}

#[tauri::command]
pub async fn save_setting(app: AppHandle, key: String, value: String) -> Result<(), String> {
    with_db(&app, |conn| {
        conn.execute(
            "INSERT OR REPLACE INTO attune_settings (key, value) VALUES (?1, ?2)",
            params![key, value],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    })
}

#[tauri::command]
pub async fn get_setting(app: AppHandle, key: String) -> Result<Option<String>, String> {
    with_db(&app, |conn| {
        let mut stmt = conn
            .prepare("SELECT value FROM attune_settings WHERE key = ?1")
            .map_err(|e| e.to_string())?;
        let mut rows = stmt.query(params![key]).map_err(|e| e.to_string())?;
        if let Some(row) = rows.next().map_err(|e| e.to_string())? {
            let v: String = row.get(0).map_err(|e| e.to_string())?;
            return Ok(Some(v));
        }
        Ok(None)
    })
}

#[tauri::command]
pub async fn set_debug_mode(app: AppHandle, enabled: bool) -> Result<(), String> {
    if !cfg!(debug_assertions) {
        with_db(&app, |conn| {
            conn.execute(
                "INSERT OR REPLACE INTO attune_settings (key, value) VALUES ('debug_mode', ?1)",
                params![if enabled { "true" } else { "false" }],
            )
            .map_err(|e| e.to_string())?;
            Ok(())
        })?;
    }

    let effective = if cfg!(debug_assertions) {
        true
    } else {
        enabled
    };

    let state = app.state::<SessionState>();
    state
        .debug_enabled
        .store(effective, Ordering::SeqCst);

    let session_active = state.active_session_id.lock().unwrap().is_some();
    if session_active {
        if effective {
            start_debug_overlay(app.clone()).await?;
        } else {
            stop_debug_overlay(app.clone()).await?;
        }
    }

    Ok(())
}

#[tauri::command]
pub async fn start_session(app: AppHandle) -> Result<String, String> {
    let state = app.state::<SessionState>();
    {
        let guard = state.active_session_id.lock().unwrap();
        if guard.is_some() {
            return Err("Session already active".to_string());
        }
    }

    let session_id = Uuid::new_v4().to_string();
    let started_at = Utc::now().timestamp();
    with_db(&app, |conn| {
        conn.execute(
            "INSERT INTO sessions (id, started_at, child_profile_id) VALUES (?1, ?2, 'default')",
            params![session_id, started_at],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    })?;

    let sensitivity = load_sensitivity(&app);
    let profile = load_feedback_profile(&app);
    let feedback_profile_name = load_feedback_profile_name(&app);
    let focus_apps = load_focus_apps(&app);
    feedback_cues::reset_cue_scheduler();
    *state.sensitivity.lock().unwrap() = sensitivity;
    *state.feedback_engine.lock().unwrap() = Some(FeedbackEngine::new(sensitivity, profile));
    *state.distraction_engine.lock().unwrap() =
        Some(DistractionFusionEngine::new(focus_apps));

    start_vision(app.clone())?;
    start_attention_overlay(app.clone()).await?;
    set_dim_opacity(app.clone(), 0.0).await?;

    let debug_enabled = load_debug_mode(&app);
    state
        .debug_enabled
        .store(debug_enabled, Ordering::SeqCst);
    if debug_enabled {
        start_debug_overlay(app.clone()).await?;
    }

    {
        let mut guard = state.active_session_id.lock().unwrap();
        *guard = Some(session_id.clone());
    }

    let app_handle = app.clone();
    let sid = session_id.clone();
    let profile_name = feedback_profile_name;
    let task = tokio::spawn(async move {
        let mut last_app: Option<(String, String, i64)> = None;
        let mut last_app_event_id: Option<i64> = None;
        let mut tick_count: u32 = 0;
        loop {
            let active = {
                let state = app_handle.state::<SessionState>();
                let id = state.active_session_id.lock().unwrap().clone();
                id
            };
            if active.as_deref() != Some(sid.as_str()) {
                break;
            }

            let sample = latest_sample();
            let now = if sample.timestamp > 0.0 {
                sample.timestamp
            } else {
                Utc::now().timestamp() as f64
            };

            let app_info = get_frontmost_app().ok();
            let app_name = app_info.as_ref().map(|a| a.app_name.as_str());
            let app_bundle = app_info.as_ref().map(|a| a.bundle_id.as_str());

            let distraction = {
                let state = app_handle.state::<SessionState>();
                let mut fusion_guard = state.distraction_engine.lock().unwrap();
                fusion_guard
                    .as_mut()
                    .map(|engine| engine.tick(&sample, app_name, app_bundle, now))
                    .unwrap_or_default()
            };

            let update = {
                let state = app_handle.state::<SessionState>();
                let mut engine_guard = state.feedback_engine.lock().unwrap();
                engine_guard
                    .as_mut()
                    .map(|engine| engine.tick(&sample, &distraction, now))
            };

            if let Some(ref update) = update {
                let _ = set_dim_opacity(app_handle.clone(), update.opacity).await;
                let _ = app_handle.emit("feedback-update", update);
                feedback_cues::handle_feedback_cues(
                    &app_handle,
                    update,
                    now,
                    &profile_name,
                );
            }

            if update.is_some() {
                let state = app_handle.state::<SessionState>();
                if state.debug_enabled.load(Ordering::SeqCst) {
                    if let Some(ref feedback) = update {
                        let tick = SessionDebugTick {
                            ts: Utc::now().timestamp(),
                            session_id: sid.clone(),
                            vision: sample.clone(),
                            app_name: app_info.as_ref().map(|a| a.app_name.clone()),
                            app_bundle: app_info.as_ref().map(|a| a.bundle_id.clone()),
                            distraction: distraction.clone(),
                            feedback: feedback.clone(),
                        };
                        let _ = app_handle.emit("session-debug-tick", tick);
                    }
                }
            }

            tick_count += 1;
            if tick_count >= 10 {
                tick_count = 0;
                if let Some(update) = update {
                    let ts = Utc::now().timestamp();
                    let sid_clone = sid.clone();
                    let raw_score = sample.score;
                    let smoothed = update.smoothed_score;
                    let effective = update.effective_score;
                    let opacity = update.opacity;
                    let state_str = serde_json::to_string(&update.state)
                        .unwrap_or_else(|_| "focused".to_string())
                        .trim_matches('"')
                        .to_string();
                    let emotion = update.emotion.clone();
                    let _ = with_db(&app_handle, move |conn| {
                        conn.execute(
                            "INSERT INTO attention_samples (session_id, ts, score, smoothed_score, effective_score, opacity, feedback_state, emotion) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                            params![
                                sid_clone,
                                ts,
                                raw_score,
                                smoothed,
                                effective,
                                opacity,
                                state_str,
                                emotion
                            ],
                        )
                        .map_err(|e| e.to_string())?;
                        Ok(())
                    });

                    let emotion_json = serde_json::json!({
                        "engaged": sample.prob_engaged,
                        "bored": sample.prob_bored,
                        "confused": sample.prob_confused,
                        "frustrated": sample.prob_frustrated,
                        "neutral": sample.prob_neutral,
                    })
                    .to_string();
                    let sid_ml = sid.clone();
                    let model_version = sample.model_version.clone();
                    let engagement = sample.engagement_prob;
                    let gaze = sample.gaze_away_prob;
                    let _ = with_db(&app_handle, move |conn| {
                        conn.execute(
                            "INSERT INTO ml_inference_samples (session_id, ts, engagement, gaze_away, emotion_json, model_version) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                            params![sid_ml, ts, engagement, gaze, emotion_json, model_version],
                        )
                        .map_err(|e| e.to_string())?;
                        Ok(())
                    });

                    for event in &distraction.events {
                        let sid_ev = sid.clone();
                        let kind = event.kind.as_str().to_string();
                        let severity = event.severity;
                        let confidence = event.confidence;
                        let bundle = event.app_bundle_id.clone();
                        let meta = event.metadata.clone();
                        let _ = with_db(&app_handle, move |conn| {
                            conn.execute(
                                "INSERT INTO distraction_events (session_id, ts, kind, severity, confidence, app_bundle_id, metadata_json) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                                params![sid_ev, ts, kind, severity, confidence, bundle, meta],
                            )
                            .map_err(|e| e.to_string())?;
                            Ok(())
                        });
                    }

                    if let Some(ref app_info) = app_info {
                        if !app_info.bundle_id.contains("attune") {
                            let current = (
                                app_info.app_name.clone(),
                                app_info.bundle_id.clone(),
                                ts,
                            );
                            if last_app.as_ref().map(|(n, b, _)| (n.clone(), b.clone()))
                                != Some((current.0.clone(), current.1.clone()))
                            {
                                let sid_clone = sid.clone();
                                let (name, bundle) = (current.0.clone(), current.1.clone());
                                let _ = with_db(&app_handle, move |conn| {
                                    conn.execute(
                                        "INSERT INTO app_focus_events (session_id, ts, bundle_id, app_name, duration_sec) VALUES (?1, ?2, ?3, ?4, 1)",
                                        params![sid_clone, ts, bundle, name],
                                    )
                                    .map_err(|e| e.to_string())?;
                                    Ok(())
                                });
                                last_app = Some(current);
                                last_app_event_id = None;
                            } else if let Some((_, _, start_ts)) = &last_app {
                                let duration = (ts - start_ts).max(1);
                                if let Some(event_id) = last_app_event_id {
                                    let _ = with_db(&app_handle, move |conn| {
                                        conn.execute(
                                            "UPDATE app_focus_events SET duration_sec = ?1 WHERE id = ?2",
                                            params![duration, event_id],
                                        )
                                        .map_err(|e| e.to_string())?;
                                        Ok(())
                                    });
                                } else {
                                    let sid_lookup = sid.clone();
                                    let bundle = app_info.bundle_id.clone();
                                    last_app_event_id = with_db(&app_handle, move |conn| {
                                        let mut stmt = conn
                                            .prepare(
                                                "SELECT id FROM app_focus_events WHERE session_id = ?1 AND bundle_id = ?2 ORDER BY ts DESC LIMIT 1",
                                            )
                                            .map_err(|e| e.to_string())?;
                                        let mut rows = stmt
                                            .query(params![sid_lookup, bundle])
                                            .map_err(|e| e.to_string())?;
                                        if let Some(row) = rows.next().map_err(|e| e.to_string())? {
                                            let id: i64 = row.get(0).map_err(|e| e.to_string())?;
                                            return Ok(Some(id));
                                        }
                                        Ok(None)
                                    })
                                    .ok()
                                    .flatten();
                                    if let Some(event_id) = last_app_event_id {
                                        let duration_copy = duration;
                                        let _ = with_db(&app_handle, move |conn| {
                                            conn.execute(
                                                "UPDATE app_focus_events SET duration_sec = ?1 WHERE id = ?2",
                                                params![duration_copy, event_id],
                                            )
                                            .map_err(|e| e.to_string())?;
                                            Ok(())
                                        });
                                    }
                                }
                            }
                        }
                    }
                }
            }

            tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
        }
    });

    *state.recorder_task.lock().unwrap() = Some(task);
    Ok(session_id)
}

#[tauri::command]
pub async fn end_session(app: AppHandle) -> Result<Option<String>, String> {
    let state = app.state::<SessionState>();
    let session_id = {
        let mut guard = state.active_session_id.lock().unwrap();
        guard.take()
    };

    let Some(session_id) = session_id else {
        return Ok(None);
    };

    if let Some(task) = state.recorder_task.lock().unwrap().take() {
        task.abort();
    }

    *state.feedback_engine.lock().unwrap() = None;
    *state.distraction_engine.lock().unwrap() = None;
    feedback_cues::reset_cue_scheduler();

    stop_vision()?;
    stop_attention_overlay(app.clone()).await?;
    stop_debug_overlay(app.clone()).await?;

    let ended_at = Utc::now().timestamp();
    with_db(&app, |conn| {
        conn.execute(
            "UPDATE sessions SET ended_at = ?1 WHERE id = ?2",
            params![ended_at, session_id],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    })?;

    if let Ok(summary) = generate_session_summary(app.clone(), session_id.clone()).await {
        let summary_clone = summary.clone();
        let sid = session_id.clone();
        let _ = with_db(&app, move |conn| {
            conn.execute(
                "UPDATE sessions SET summary_text = ?1 WHERE id = ?2",
                params![summary_clone, sid],
            )
            .map_err(|e| e.to_string())?;
            Ok(())
        });
    }

    let _ = maybe_generate_weekly_report(app.clone()).await;
    Ok(Some(session_id))
}

#[tauri::command]
pub async fn get_active_session(app: AppHandle) -> Result<Option<String>, String> {
    Ok(app
        .state::<SessionState>()
        .active_session_id
        .lock()
        .unwrap()
        .clone())
}

#[tauri::command]
pub async fn list_sessions(app: AppHandle, limit: i64) -> Result<Vec<SessionSummary>, String> {
    with_db(&app, |conn| {
        let mut stmt = conn
            .prepare(
                "SELECT s.id, s.started_at, s.ended_at, s.summary_text, s.child_profile_id,
                        (SELECT AVG(score) FROM attention_samples WHERE session_id = s.id) as avg_score
                 FROM sessions s ORDER BY s.started_at DESC LIMIT ?1",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![limit], |row| {
                Ok(SessionSummary {
                    id: row.get(0)?,
                    started_at: row.get(1)?,
                    ended_at: row.get(2)?,
                    summary_text: row.get(3)?,
                    child_profile_id: row.get(4)?,
                    avg_score: row.get(5)?,
                })
            })
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())
    })
}

#[tauri::command]
pub async fn get_session_timeline(
    app: AppHandle,
    session_id: String,
) -> Result<SessionTimeline, String> {
    with_db(&app, |conn| {
        let mut score_stmt = conn
            .prepare("SELECT ts, score FROM attention_samples WHERE session_id = ?1 ORDER BY ts ASC")
            .map_err(|e| e.to_string())?;
        let scores = score_stmt
            .query_map(params![session_id.clone()], |row| {
                Ok(AttentionPoint {
                    ts: row.get(0)?,
                    score: row.get(1)?,
                })
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;

        let mut app_stmt = conn
            .prepare(
                "SELECT ts, app_name, bundle_id, duration_sec FROM app_focus_events WHERE session_id = ?1 ORDER BY ts ASC",
            )
            .map_err(|e| e.to_string())?;
        let apps = app_stmt
            .query_map(params![session_id.clone()], |row| {
                Ok(AppFocusPoint {
                    ts: row.get(0)?,
                    app_name: row.get(1)?,
                    bundle_id: row.get(2)?,
                    duration_sec: row.get(3)?,
                })
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;

        let mut dist_stmt = conn
            .prepare(
                "SELECT ts, kind, severity, confidence, app_bundle_id FROM distraction_events WHERE session_id = ?1 ORDER BY ts ASC",
            )
            .map_err(|e| e.to_string())?;
        let distractions = dist_stmt
            .query_map(params![session_id], |row| {
                Ok(DistractionPoint {
                    ts: row.get(0)?,
                    kind: row.get(1)?,
                    severity: row.get(2)?,
                    confidence: row.get(3)?,
                    app_bundle_id: row.get(4)?,
                })
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;

        Ok(SessionTimeline {
            scores,
            apps,
            distractions,
        })
    })
}

#[tauri::command]
pub async fn submit_distraction_feedback(
    app: AppHandle,
    session_id: String,
    event_kind: String,
    helpful: bool,
) -> Result<(), String> {
    let ts = Utc::now().timestamp();
    with_db(&app, |conn| {
        conn.execute(
            "INSERT INTO distraction_feedback (session_id, ts, event_kind, helpful) VALUES (?1, ?2, ?3, ?4)",
            params![session_id, ts, event_kind, helpful as i32],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    })
}

#[derive(Serialize, Deserialize, Clone)]
pub struct WeeklyReportRow {
    pub id: String,
    pub week_start: i64,
    pub report_json: String,
    pub created_at: i64,
}

#[tauri::command]
pub async fn list_weekly_reports(app: AppHandle) -> Result<Vec<WeeklyReportRow>, String> {
    with_db(&app, |conn| {
        let mut stmt = conn
            .prepare("SELECT id, week_start, report_json, created_at FROM weekly_reports ORDER BY week_start DESC")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| {
                Ok(WeeklyReportRow {
                    id: row.get(0)?,
                    week_start: row.get(1)?,
                    report_json: row.get(2)?,
                    created_at: row.get(3)?,
                })
            })
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())
    })
}

async fn maybe_generate_weekly_report(app: AppHandle) -> Result<(), String> {
    let now = Utc::now();
    let weekday = now.weekday().num_days_from_monday();
    let date = now.date_naive() - chrono::Duration::days(weekday as i64);
    let week_start = Utc
        .from_utc_datetime(&date.and_hms_opt(0, 0, 0).unwrap())
        .timestamp();

    let exists = with_db(&app, |conn| {
        let mut stmt = conn
            .prepare("SELECT 1 FROM weekly_reports WHERE week_start = ?1 LIMIT 1")
            .map_err(|e| e.to_string())?;
        let mut rows = stmt.query(params![week_start]).map_err(|e| e.to_string())?;
        Ok(rows.next().map_err(|e| e.to_string())?.is_some())
    })?;

    if exists {
        return Ok(());
    }

    let week_ago = (now - Duration::days(7)).timestamp();
    let sessions = list_sessions(app.clone(), 100).await?;
    let recent: Vec<SessionSummary> = sessions
        .into_iter()
        .filter(|s| s.started_at >= week_ago && s.ended_at.is_some())
        .collect();

    if recent.is_empty() {
        return Ok(());
    }

    if let Ok(report) = generate_weekly_report(app.clone(), recent).await {
        let id = Uuid::new_v4().to_string();
        with_db(&app, |conn| {
            conn.execute(
                "INSERT INTO weekly_reports (id, week_start, report_json, created_at) VALUES (?1, ?2, ?3, ?4)",
                params![id, week_start, report, now.timestamp()],
            )
            .map_err(|e| e.to_string())?;
            Ok(())
        })?;
    }

    Ok(())
}

#[tauri::command]
pub async fn ensure_weekly_report(app: AppHandle) -> Result<(), String> {
    maybe_generate_weekly_report(app).await
}

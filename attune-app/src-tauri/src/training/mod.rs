mod compliance;
mod insight;
mod staircase;

pub use compliance::{get_training_compliance, TrainingCompliance};
pub use insight::{get_training_insights, TrainingInsights, TrainingSessionSummary};
pub use staircase::{adjust_difficulty, DifficultyState, RunMetrics};

use crate::attune_db::with_db;
use crate::screening::ScreeningReport;
use crate::vision::{latest_sample, set_vision_capture_mode, start_vision, stop_vision};
use chrono::Utc;
use rusqlite::params;
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::{AppHandle, Manager};
use tokio::task::JoinHandle;
use uuid::Uuid;

pub struct TrainingState {
    pub active_session_id: Mutex<Option<String>>,
    pub current_difficulty: Mutex<DifficultyState>,
    pub run_index: Mutex<i32>,
    pub recorder_task: Mutex<Option<JoinHandle<()>>>,
    pub gaze_sum: Mutex<f32>,
    pub gaze_count: Mutex<u32>,
}

impl Default for TrainingState {
    fn default() -> Self {
        Self {
            active_session_id: Mutex::new(None),
            current_difficulty: Mutex::new(DifficultyState::default()),
            run_index: Mutex::new(0),
            recorder_task: Mutex::new(None),
            gaze_sum: Mutex::new(0.0),
            gaze_count: Mutex::new(0),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrainingSessionStart {
    pub session_id: String,
    pub difficulty: DifficultyState,
    pub world_id: i32,
    pub minutes_remaining_today: f32,
    pub locked_out: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrainingRunResult {
    pub run_index: i32,
    pub difficulty: DifficultyState,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrainingSessionReport {
    pub session_id: String,
    pub mission_minutes: f32,
    pub world_id: i32,
    pub steer_accuracy: f32,
    pub tap_accuracy: f32,
    pub multitask_cost: f32,
    pub gaze_engagement: f32,
    pub mean_rt_ms: f32,
    pub run_count: i32,
    pub difficulty_final: DifficultyState,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DifficultySeed {
    pub difficulty: DifficultyState,
    pub seeded_from_screening: bool,
    pub antisaccade_error_rate: Option<f32>,
    pub vigilance_decay: Option<f32>,
}

fn load_persisted_difficulty(app: &AppHandle) -> DifficultyState {
    with_db(app, |conn| {
        let mut stmt = conn
            .prepare("SELECT value FROM attune_settings WHERE key = 'training_difficulty_state'")
            .map_err(|e| e.to_string())?;
        let mut rows = stmt.query([]).map_err(|e| e.to_string())?;
        if let Some(row) = rows.next().map_err(|e| e.to_string())? {
            let v: String = row.get(0).map_err(|e| e.to_string())?;
            if let Ok(d) = serde_json::from_str::<DifficultyState>(&v) {
                return Ok(d);
            }
        }
        Ok(DifficultyState::default())
    })
    .unwrap_or_default()
}

fn save_persisted_difficulty(app: &AppHandle, difficulty: &DifficultyState) -> Result<(), String> {
    let json = serde_json::to_string(difficulty).map_err(|e| e.to_string())?;
    with_db(app, |conn| {
        conn.execute(
            "INSERT OR REPLACE INTO attune_settings (key, value) VALUES ('training_difficulty_state', ?1)",
            params![json],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    })
}

fn compute_world_id(total_minutes: f32) -> i32 {
    if total_minutes >= 400.0 {
        4
    } else if total_minutes >= 250.0 {
        3
    } else if total_minutes >= 100.0 {
        2
    } else {
        1
    }
}

fn total_training_minutes(app: &AppHandle) -> f32 {
    with_db(app, |conn| {
        conn.query_row(
            "SELECT COALESCE(SUM(mission_minutes), 0) FROM training_sessions WHERE ended_at IS NOT NULL",
            [],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())
    })
    .unwrap_or(0.0)
}

pub fn screening_seed(app: &AppHandle) -> DifficultySeed {
    let persisted = load_persisted_difficulty(app);

    let (antisaccade_error, vigilance_decay) = with_db(app, |conn| {
        let mut stmt = conn
            .prepare(
                "SELECT report_json FROM screening_sessions
                 WHERE ended_at IS NOT NULL
                 ORDER BY started_at DESC LIMIT 1",
            )
            .map_err(|e| e.to_string())?;
        let mut rows = stmt.query([]).map_err(|e| e.to_string())?;
        if let Some(row) = rows.next().map_err(|e| e.to_string())? {
            let json: Option<String> = row.get(0).map_err(|e| e.to_string())?;
            if let Some(json) = json {
                if let Ok(report) = serde_json::from_str::<ScreeningReport>(&json) {
                    let err = report
                        .trial_summaries
                        .iter()
                        .find(|t| t.task_id == "antisaccade")
                        .map(|t| t.error_rate);
                    let decay = report
                        .naturalistic_features
                        .as_ref()
                        .map(|n| n.vigilance_decay);
                    return Ok((err, decay));
                }
            }
        }
        Ok((None, None))
    })
    .unwrap_or((None, None));

    let has_seed = antisaccade_error.is_some() || vigilance_decay.is_some();
    let difficulty = if has_seed {
        DifficultyState::from_screening_seed(antisaccade_error, vigilance_decay)
    } else {
        persisted
    };

    DifficultySeed {
        difficulty,
        seeded_from_screening: has_seed,
        antisaccade_error_rate: antisaccade_error,
        vigilance_decay,
    }
}

#[tauri::command]
pub async fn get_training_difficulty_seed(app: AppHandle) -> Result<DifficultySeed, String> {
    Ok(screening_seed(&app))
}

#[tauri::command]
pub async fn get_active_training(app: AppHandle) -> Result<Option<String>, String> {
    let id = {
        let state = app.state::<TrainingState>();
        let guard = state.active_session_id.lock().unwrap();
        guard.clone()
    };
    Ok(id)
}

#[tauri::command]
pub async fn start_training_session(app: AppHandle) -> Result<TrainingSessionStart, String> {
    let state = app.state::<TrainingState>();
    {
        if state.active_session_id.lock().unwrap().is_some() {
            return Err("Training session already active".to_string());
        }
    }

    if crate::session::get_active_session(app.clone()).await?.is_some() {
        return Err("End the learning session before starting Train mode.".to_string());
    }

    if crate::screening::get_active_screening(app.clone())
        .await?
        .is_some()
    {
        return Err("Finish screening before starting Train mode.".to_string());
    }

    let compliance = compliance::get_training_compliance(&app)?;
    if compliance.locked_out {
        return Err("Today's training budget is complete. Come back tomorrow.".to_string());
    }

    let seed = screening_seed(&app);
    let world_id = compute_world_id(total_training_minutes(&app));
    let session_id = Uuid::new_v4().to_string();
    let started_at = Utc::now().timestamp();

    with_db(&app, |conn| {
        conn.execute(
            "INSERT INTO training_sessions (id, child_profile_id, started_at, world_id)
             VALUES (?1, 'default', ?2, ?3)",
            params![session_id, started_at, world_id],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    })?;

    set_vision_capture_mode(1)?;
    start_vision(app.clone())?;

    *state.current_difficulty.lock().unwrap() = seed.difficulty.clone();
    *state.run_index.lock().unwrap() = 0;
    *state.gaze_sum.lock().unwrap() = 0.0;
    *state.gaze_count.lock().unwrap() = 0;
    *state.active_session_id.lock().unwrap() = Some(session_id.clone());

    let app_handle = app.clone();
    let sid = session_id.clone();
    let task = tokio::spawn(async move {
        loop {
            let active = {
                let st = app_handle.state::<TrainingState>();
                let id = st.active_session_id.lock().unwrap().clone();
                id
            };
            if active.as_deref() != Some(sid.as_str()) {
                break;
            }

            let sample = latest_sample();
            let ts = if sample.timestamp > 0.0 {
                sample.timestamp
            } else {
                Utc::now().timestamp() as f64
            };

            let engagement = sample.engagement_prob;
            {
                let st = app_handle.state::<TrainingState>();
                if sample.face_present {
                    *st.gaze_sum.lock().unwrap() += 1.0 - sample.gaze_away_prob;
                    *st.gaze_count.lock().unwrap() += 1;
                }
            }

            let sid_insert = sid.clone();
            let face_present = if sample.face_present { 1 } else { 0 };
            let _ = with_db(&app_handle, move |conn| {
                conn.execute(
                    "INSERT INTO training_gaze_samples (session_id, ts, gaze_away, engagement, face_present)
                     VALUES (?1, ?2, ?3, ?4, ?5)",
                    params![
                        sid_insert,
                        ts,
                        sample.gaze_away_prob,
                        engagement,
                        face_present,
                    ],
                )
                .map_err(|e| e.to_string())?;
                Ok(())
            });

            tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
        }
    });

    *state.recorder_task.lock().unwrap() = Some(task);

    Ok(TrainingSessionStart {
        session_id,
        difficulty: seed.difficulty,
        world_id,
        minutes_remaining_today: compliance.minutes_remaining,
        locked_out: false,
    })
}

#[tauri::command]
pub async fn record_training_run(
    app: AppHandle,
    metrics: RunMetrics,
) -> Result<TrainingRunResult, String> {
    let state = app.state::<TrainingState>();
    let session_id = state
        .active_session_id
        .lock()
        .unwrap()
        .clone()
        .ok_or_else(|| "No active training session".to_string())?;

    let run_index = {
        let mut idx = state.run_index.lock().unwrap();
        *idx += 1;
        *idx
    };

    let mut difficulty = state.current_difficulty.lock().unwrap().clone();
    adjust_difficulty(&mut difficulty, &metrics);
    *state.current_difficulty.lock().unwrap() = difficulty.clone();
    save_persisted_difficulty(&app, &difficulty)?;

    let diff_json = serde_json::to_string(&difficulty).map_err(|e| e.to_string())?;
    with_db(&app, |conn| {
        conn.execute(
            "INSERT INTO training_runs
             (session_id, run_index, phase, started_at, ended_at, steer_accuracy, tap_accuracy,
              multitask_cost, mean_rt_ms, gaze_engagement, difficulty_json)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
            params![
                session_id,
                run_index,
                metrics.phase,
                Utc::now().timestamp() as f64,
                Utc::now().timestamp() as f64,
                metrics.steer_accuracy,
                metrics.tap_accuracy,
                metrics.multitask_cost,
                metrics.mean_rt_ms,
                metrics.gaze_engagement,
                diff_json,
            ],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    })?;

    Ok(TrainingRunResult {
        run_index,
        difficulty,
    })
}

#[tauri::command]
pub async fn record_training_event(
    app: AppHandle,
    event_type: String,
    correct: Option<bool>,
    rt_ms: Option<f32>,
) -> Result<(), String> {
    let state = app.state::<TrainingState>();
    let session_id = state
        .active_session_id
        .lock()
        .unwrap()
        .clone()
        .ok_or_else(|| "No active training session".to_string())?;
    let run_index = *state.run_index.lock().unwrap();

    with_db(&app, |conn| {
        conn.execute(
            "INSERT INTO training_events (session_id, run_index, ts, event_type, correct, rt_ms)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                session_id,
                run_index,
                Utc::now().timestamp() as f64,
                event_type,
                correct.map(|c| if c { 1 } else { 0 }),
                rt_ms,
            ],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    })
}

#[tauri::command]
pub async fn end_training_session(
    app: AppHandle,
    mission_minutes: f32,
    steer_accuracy: f32,
    tap_accuracy: f32,
    multitask_cost: f32,
    mean_rt_ms: f32,
) -> Result<TrainingSessionReport, String> {
    let state = app.state::<TrainingState>();
    let session_id = state
        .active_session_id
        .lock()
        .unwrap()
        .take()
        .ok_or_else(|| "No active training session".to_string())?;

    if let Some(task) = state.recorder_task.lock().unwrap().take() {
        task.abort();
    }

    stop_vision()?;

    let (gaze_sum, gaze_count) = {
        let sum = *state.gaze_sum.lock().unwrap();
        let count = *state.gaze_count.lock().unwrap();
        *state.gaze_sum.lock().unwrap() = 0.0;
        *state.gaze_count.lock().unwrap() = 0;
        (sum, count)
    };

    let gaze_engagement = if gaze_count > 0 {
        gaze_sum / gaze_count as f32
    } else {
        0.0
    };

    let difficulty_final = state.current_difficulty.lock().unwrap().clone();
    save_persisted_difficulty(&app, &difficulty_final)?;

    let ended_at = Utc::now().timestamp();
    let summary = TrainingSessionReport {
        session_id: session_id.clone(),
        mission_minutes,
        world_id: compute_world_id(total_training_minutes(&app)),
        steer_accuracy,
        tap_accuracy,
        multitask_cost,
        gaze_engagement,
        mean_rt_ms,
        run_count: *state.run_index.lock().unwrap(),
        difficulty_final: difficulty_final.clone(),
    };

    let summary_json = serde_json::to_string(&summary).map_err(|e| e.to_string())?;

    with_db(&app, |conn| {
        conn.execute(
            "UPDATE training_sessions SET ended_at = ?1, mission_minutes = ?2,
             steer_accuracy = ?3, tap_accuracy = ?4, multitask_cost = ?5,
             gaze_engagement = ?6, mean_rt_ms = ?7, summary_json = ?8
             WHERE id = ?9",
            params![
                ended_at,
                mission_minutes,
                steer_accuracy,
                tap_accuracy,
                multitask_cost,
                gaze_engagement,
                mean_rt_ms,
                summary_json,
                session_id,
            ],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    })?;

    *state.run_index.lock().unwrap() = 0;
    compliance::add_mission_minutes(&app, mission_minutes)?;

    Ok(summary)
}

#[tauri::command]
pub async fn list_training_sessions(
    app: AppHandle,
    limit: i32,
) -> Result<Vec<TrainingSessionSummary>, String> {
    insight::list_training_sessions(&app, limit)
}

#[tauri::command]
pub async fn get_training_report(
    app: AppHandle,
    session_id: String,
) -> Result<TrainingSessionReport, String> {
    with_db(&app, |conn| {
        let json: Option<String> = conn
            .query_row(
                "SELECT summary_json FROM training_sessions WHERE id = ?1",
                params![session_id],
                |r| r.get(0),
            )
            .map_err(|e| e.to_string())?;
        if let Some(json) = json {
            serde_json::from_str(&json).map_err(|e| e.to_string())
        } else {
            Err("Report not found".to_string())
        }
    })
}

#[tauri::command]
pub async fn get_training_compliance_cmd(app: AppHandle) -> Result<TrainingCompliance, String> {
    get_training_compliance(&app)
}

#[tauri::command]
pub async fn get_training_insights_cmd(app: AppHandle) -> Result<TrainingInsights, String> {
    get_training_insights(&app)
}

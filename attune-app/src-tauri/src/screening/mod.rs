mod insights;
mod naturalistic;
mod norms;
mod trials;

pub use insights::{
    build_report_context, insights_to_flags, ScreeningInsight, ScreeningQuality,
};
pub use naturalistic::NaturalisticFeatureSet;
pub use trials::{
    compute_baseline_yaw, load_and_score_trials, record_trial, TrialTaskSummary,
};

use crate::attune_db::with_db;
use crate::vision::{latest_sample, set_vision_capture_mode, start_vision, stop_vision};
use chrono::Utc;
use rusqlite::params;
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::{AppHandle, Manager};
use tokio::task::JoinHandle;
use uuid::Uuid;

pub struct ScreeningState {
    pub active_screening_id: Mutex<Option<String>>,
    pub current_task_id: Mutex<String>,
    pub recorder_task: Mutex<Option<JoinHandle<()>>>,
}

impl Default for ScreeningState {
    fn default() -> Self {
        Self {
            active_screening_id: Mutex::new(None),
            current_task_id: Mutex::new("idle".to_string()),
            recorder_task: Mutex::new(None),
        }
    }
}

#[derive(Serialize, Deserialize, Clone)]
pub struct ScreeningSessionRow {
    pub id: String,
    pub started_at: i64,
    pub ended_at: Option<i64>,
    pub report_json: Option<String>,
    pub label: Option<i32>,
    pub summary_text: Option<String>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct ScreeningFeatureSet {
    pub task_id: String,
    pub sample_count: usize,
    pub face_present_ratio: f32,
    pub mean_gaze_away: f32,
    pub mean_face_quality: f32,
    pub pct_on_screen: f32,
    pub blink_rate_per_min: f32,
    pub yaw_std: f32,
    pub pitch_std: f32,
    pub fixation_count: u32,
    pub mean_fixation_duration_ms: f32,
    pub saccade_count: u32,
    pub mean_saccade_latency_ms: f32,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct ScreeningFlag {
    pub code: String,
    pub message: String,
    pub severity: String,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct ScreeningReport {
    pub screening_id: String,
    pub generated_at: i64,
    pub disclaimer: String,
    pub child_age: u8,
    pub baseline_yaw: f32,
    pub features_by_task: Vec<ScreeningFeatureSet>,
    pub trial_summaries: Vec<TrialTaskSummary>,
    pub naturalistic_features: Option<NaturalisticFeatureSet>,
    pub quality: ScreeningQuality,
    pub insights: Vec<ScreeningInsight>,
    pub summary_text: String,
    pub flags: Vec<ScreeningFlag>,
    pub classifier_available: bool,
    pub classifier_prediction: Option<f32>,
    pub classifier_label: Option<String>,
}

const FIXATION_MIN_MS: f64 = 70.0;
const SACCADE_VELOCITY_THRESH: f32 = 0.08;
const BLINK_EYE_THRESHOLD: f32 = 25.0;

fn compute_task_features(
    task_id: &str,
    rows: &[(f64, f32, f32, f32, f32, f32, i32, f32)],
) -> ScreeningFeatureSet {
    if rows.is_empty() {
        return ScreeningFeatureSet {
            task_id: task_id.to_string(),
            sample_count: 0,
            face_present_ratio: 0.0,
            mean_gaze_away: 0.0,
            mean_face_quality: 0.0,
            pct_on_screen: 0.0,
            blink_rate_per_min: 0.0,
            yaw_std: 0.0,
            pitch_std: 0.0,
            fixation_count: 0,
            mean_fixation_duration_ms: 0.0,
            saccade_count: 0,
            mean_saccade_latency_ms: 0.0,
        };
    }

    let n = rows.len() as f32;
    let face_present_ratio = rows.iter().filter(|r| r.6 != 0).count() as f32 / n.max(1.0);
    let mean_gaze_away = rows.iter().map(|r| r.4).sum::<f32>() / n;
    let mean_face_quality = rows.iter().map(|r| r.5).sum::<f32>() / n;
    let pct_on_screen =
        rows.iter().filter(|r| r.4 < 0.45 && r.6 != 0).count() as f32 / n * 100.0;

    let duration_sec =
        rows.last().map(|r| r.0).unwrap_or(0.0) - rows.first().map(|r| r.0).unwrap_or(0.0);
    let blink_count = rows
        .windows(2)
        .filter(|w| w[0].3 >= BLINK_EYE_THRESHOLD && w[1].3 < BLINK_EYE_THRESHOLD)
        .count();
    let blink_rate_per_min = if duration_sec > 0.1 {
        blink_count as f32 / (duration_sec as f32 / 60.0)
    } else {
        0.0
    };

    let yaws: Vec<f32> = rows.iter().map(|r| r.1).collect();
    let pitches: Vec<f32> = rows.iter().map(|r| r.2).collect();
    let yaw_std = std_dev(&yaws);
    let pitch_std = std_dev(&pitches);

    let mut fixation_durations_ms: Vec<f32> = Vec::new();
    let mut saccade_latencies_ms: Vec<f32> = Vec::new();
    let mut fixation_count = 0u32;
    let mut saccade_count = 0u32;
    let mut i = 0usize;
    while i < rows.len() {
        if rows[i].6 == 0 {
            i += 1;
            continue;
        }
        let start = rows[i].0;
        let mut j = i;
        let mut max_vel = 0.0f32;
        while j + 1 < rows.len() && rows[j + 1].6 != 0 {
            let dt = (rows[j + 1].0 - rows[j].0) as f32;
            if dt > 0.0 {
                let vel = ((rows[j + 1].1 - rows[j].1).powi(2)
                    + (rows[j + 1].2 - rows[j].2).powi(2))
                    .sqrt()
                    / dt;
                max_vel = max_vel.max(vel);
            }
            if max_vel > SACCADE_VELOCITY_THRESH {
                break;
            }
            j += 1;
        }
        let duration_ms = ((rows[j].0 - start) * 1000.0) as f32;
        if max_vel <= SACCADE_VELOCITY_THRESH && duration_ms >= FIXATION_MIN_MS as f32 {
            fixation_count += 1;
            fixation_durations_ms.push(duration_ms);
        } else if max_vel > SACCADE_VELOCITY_THRESH {
            saccade_count += 1;
            if j + 1 < rows.len() {
                saccade_latencies_ms.push(((rows[j + 1].0 - start) * 1000.0) as f32);
            }
        }
        i = (j + 1).max(i + 1);
    }

    let mean_fixation_duration_ms = if fixation_durations_ms.is_empty() {
        0.0
    } else {
        fixation_durations_ms.iter().sum::<f32>() / fixation_durations_ms.len() as f32
    };
    let mean_saccade_latency_ms = if saccade_latencies_ms.is_empty() {
        0.0
    } else {
        saccade_latencies_ms.iter().sum::<f32>() / saccade_latencies_ms.len() as f32
    };

    ScreeningFeatureSet {
        task_id: task_id.to_string(),
        sample_count: rows.len(),
        face_present_ratio,
        mean_gaze_away,
        mean_face_quality,
        pct_on_screen,
        blink_rate_per_min,
        yaw_std,
        pitch_std,
        fixation_count,
        mean_fixation_duration_ms,
        saccade_count,
        mean_saccade_latency_ms,
    }
}

fn std_dev(values: &[f32]) -> f32 {
    if values.len() < 2 {
        return 0.0;
    }
    let mean = values.iter().sum::<f32>() / values.len() as f32;
    let var = values.iter().map(|v| (v - mean).powi(2)).sum::<f32>() / values.len() as f32;
    var.sqrt()
}

fn classifier_validated(app: &AppHandle) -> bool {
    with_db(app, |conn| {
        let mut stmt = conn
            .prepare("SELECT value FROM attune_settings WHERE key = 'screening_classifier_validated'")
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

fn flatten_classifier_features(features: &[ScreeningFeatureSet], trials: &[TrialTaskSummary]) -> Vec<f32> {
    let mut vec = Vec::new();
    let task_order = ["fixation", "prosaccade", "antisaccade"];
    for task in task_order {
        if let Some(f) = features.iter().find(|x| x.task_id == task) {
            vec.extend([
                f.face_present_ratio,
                f.mean_gaze_away,
                f.pct_on_screen,
                f.blink_rate_per_min,
                f.yaw_std,
                f.pitch_std,
                f.fixation_count as f32,
                f.mean_fixation_duration_ms,
                f.saccade_count as f32,
                f.mean_saccade_latency_ms,
            ]);
        } else {
            vec.extend([0.0; 10]);
        }
    }
    for task in ["prosaccade", "antisaccade"] {
        if let Some(t) = trials.iter().find(|x| x.task_id == task) {
            vec.extend([
                t.trial_count as f32,
                t.scored_count as f32,
                t.error_count as f32,
                t.error_rate,
                t.mean_latency_ms,
            ]);
        } else {
            vec.extend([0.0; 5]);
        }
    }
    vec
}

#[cfg(target_os = "macos")]
mod classifier_ffi {
    extern "C" {
        pub fn attune_screening_predict(
            features: *const f32,
            feature_count: i32,
            out_prob: *mut f32,
        ) -> bool;
        pub fn attune_screening_model_loaded() -> bool;
    }
}

fn run_classifier(
    app: &AppHandle,
    features: &[ScreeningFeatureSet],
    trials: &[TrialTaskSummary],
) -> (bool, Option<f32>, Option<String>) {
    let validated = classifier_validated(app);
    if !validated {
        return (false, None, None);
    }

    let feature_vec = flatten_classifier_features(features, trials);

    #[cfg(target_os = "macos")]
    {
        let loaded = unsafe { classifier_ffi::attune_screening_model_loaded() };
        if !loaded {
            return (true, None, None);
        }
        let mut prob = 0.0f32;
        let ok = unsafe {
            classifier_ffi::attune_screening_predict(
                feature_vec.as_ptr(),
                feature_vec.len() as i32,
                &mut prob,
            )
        };
        if ok {
            let label = if prob >= 0.5 {
                "Research classifier: pattern consistent with labeled cohort indicator (not diagnostic)"
            } else {
                "Research classifier: pattern within typical labeled cohort range (not diagnostic)"
            };
            return (true, Some(prob), Some(label.to_string()));
        }
        return (true, None, None);
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = (app, feature_vec);
        (validated, None, None)
    }
}

pub fn build_report_from_db(app: &AppHandle, screening_id: &str) -> Result<ScreeningReport, String> {
    let rows: Vec<(String, f64, f32, f32, f32, f32, i32, f32)> = with_db(app, |conn| {
        let mut stmt = conn.prepare(
            "SELECT task_id, ts, yaw, pitch, eye_open, gaze_away, face_present, face_quality
             FROM screening_samples WHERE screening_id = ?1 ORDER BY task_id, ts ASC",
        )
        .map_err(|e| e.to_string())?;
        let collected = stmt
            .query_map(params![screening_id], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, f64>(1)?,
                    row.get::<_, f32>(2)?,
                    row.get::<_, f32>(3)?,
                    row.get::<_, f32>(4)?,
                    row.get::<_, f32>(5)?,
                    row.get::<_, i32>(6)?,
                    row.get::<_, f32>(7)?,
                ))
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        Ok(collected)
    })?;

    let mut by_task: std::collections::BTreeMap<
        String,
        Vec<(f64, f32, f32, f32, f32, f32, i32, f32)>,
    > = std::collections::BTreeMap::new();
    for (task_id, ts, yaw, pitch, eye_open, gaze_away, face_present, face_quality) in rows {
        by_task.entry(task_id).or_default().push((
            ts,
            yaw,
            pitch,
            eye_open,
            gaze_away,
            face_quality,
            face_present,
            0.0,
        ));
    }

    let fixation_rows: Vec<(f64, f32, f32, f32, f32, f32, i32, f32)> = by_task
        .get("fixation")
        .cloned()
        .unwrap_or_default();
    let baseline_yaw = compute_baseline_yaw(&fixation_rows);

    let trial_summaries = load_and_score_trials(app, screening_id, baseline_yaw)?;

    let naturalistic_rows: Vec<(f64, f32, f32, f32, i32, f32)> = with_db(app, |conn| {
        let mut stmt = conn.prepare(
            "SELECT ts, yaw, pitch, gaze_away, face_present, engagement
             FROM screening_samples
             WHERE screening_id = ?1 AND task_id = 'naturalistic_viewing'
             ORDER BY ts ASC",
        )
        .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![screening_id], |row| {
                Ok((
                    row.get::<_, f64>(0)?,
                    row.get::<_, f32>(1)?,
                    row.get::<_, f32>(2)?,
                    row.get::<_, f32>(3)?,
                    row.get::<_, i32>(4)?,
                    row.get::<_, f32>(5)?,
                ))
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        Ok(rows)
    })?;

    let naturalistic_features = if naturalistic_rows.is_empty() {
        None
    } else {
        Some(naturalistic::compute_naturalistic_features(&naturalistic_rows))
    };

    let task_order = ["fixation", "prosaccade", "antisaccade", "naturalistic_viewing"];
    let mut features_by_task: Vec<ScreeningFeatureSet> = Vec::new();
    for task in task_order {
        if let Some(samples) = by_task.get(task) {
            features_by_task.push(compute_task_features(task, samples));
        }
    }
    for (task, samples) in &by_task {
        if !task_order.contains(&task.as_str()) {
            features_by_task.push(compute_task_features(task, samples));
        }
    }

    let (quality, insights, summary_text, child_age) =
        build_report_context(app, &features_by_task, &trial_summaries, naturalistic_features.as_ref());
    let flags = insights_to_flags(&insights);

    let (classifier_available, classifier_prediction, classifier_label) =
        run_classifier(app, &features_by_task, &trial_summaries);

    Ok(ScreeningReport {
        screening_id: screening_id.to_string(),
        generated_at: Utc::now().timestamp(),
        disclaimer: "This screening summarizes attention-related eye movement patterns. It is not a medical diagnosis.".to_string(),
        child_age,
        baseline_yaw,
        features_by_task,
        trial_summaries,
        naturalistic_features,
        quality,
        insights,
        summary_text,
        flags,
        classifier_available,
        classifier_prediction,
        classifier_label,
    })
}

#[tauri::command]
pub async fn start_screening(app: AppHandle) -> Result<String, String> {
    let state = app.state::<ScreeningState>();
    {
        let guard = state.active_screening_id.lock().unwrap();
        if guard.is_some() {
            return Err("Screening already active".to_string());
        }
    }

    if crate::session::get_active_session(app.clone()).await?.is_some() {
        return Err("End the learning session before starting a screening.".to_string());
    }

    let screening_id = Uuid::new_v4().to_string();
    let started_at = Utc::now().timestamp();
    with_db(&app, |conn| {
        conn.execute(
            "INSERT INTO screening_sessions (id, started_at, child_profile_id) VALUES (?1, ?2, 'default')",
            params![screening_id, started_at],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    })?;

    set_vision_capture_mode(1)?;
    start_vision(app.clone())?;

    {
        *state.current_task_id.lock().unwrap() = "fixation".to_string();
        *state.active_screening_id.lock().unwrap() = Some(screening_id.clone());
    }

    let app_handle = app.clone();
    let sid = screening_id.clone();
    let task = tokio::spawn(async move {
        loop {
            let active = {
                let st = app_handle.state::<ScreeningState>();
                let guard = st.active_screening_id.lock().unwrap();
                guard.clone()
            };
            if active.as_deref() != Some(sid.as_str()) {
                break;
            }

            let task_id = {
                let st = app_handle.state::<ScreeningState>();
                let guard = st.current_task_id.lock().unwrap();
                guard.clone()
            };

            let sample = latest_sample();
            let ts = if sample.timestamp > 0.0 {
                sample.timestamp
            } else {
                Utc::now().timestamp() as f64
            };

            let sid_insert = sid.clone();
            let task_insert = task_id.clone();
            let face_present = if sample.face_present { 1 } else { 0 };
            let _ = with_db(&app_handle, move |conn| {
                conn.execute(
                    "INSERT INTO screening_samples (screening_id, task_id, ts, yaw, pitch, eye_open, gaze_away, face_present, face_quality, engagement)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
                    params![
                        sid_insert,
                        task_insert,
                        ts,
                        sample.yaw,
                        sample.pitch,
                        sample.eye_openness,
                        sample.gaze_away_prob,
                        face_present,
                        sample.face_quality,
                        sample.engagement_prob,
                    ],
                )
                .map_err(|e| e.to_string())?;
                Ok(())
            });

            tokio::time::sleep(tokio::time::Duration::from_millis(50)).await;
        }
    });

    *state.recorder_task.lock().unwrap() = Some(task);
    Ok(screening_id)
}

#[tauri::command]
pub async fn set_screening_task(app: AppHandle, task_id: String) -> Result<(), String> {
    let state = app.state::<ScreeningState>();
    if state.active_screening_id.lock().unwrap().is_none() {
        return Err("No active screening".to_string());
    }
    *state.current_task_id.lock().unwrap() = task_id;
    Ok(())
}

#[tauri::command]
pub fn get_screening_timestamp() -> f64 {
    let sample = latest_sample();
    if sample.timestamp > 0.0 {
        sample.timestamp
    } else {
        Utc::now().timestamp() as f64
    }
}

#[tauri::command]
pub async fn record_screening_trial(
    app: AppHandle,
    task_id: String,
    trial_index: u8,
    cue_side: String,
    cue_onset_ts: f64,
) -> Result<(), String> {
    let state = app.state::<ScreeningState>();
    let screening_id = state
        .active_screening_id
        .lock()
        .unwrap()
        .clone()
        .ok_or_else(|| "No active screening".to_string())?;
    record_trial(
        &app,
        &screening_id,
        &task_id,
        trial_index,
        &cue_side,
        cue_onset_ts,
    )
}

#[tauri::command]
pub async fn end_screening(app: AppHandle) -> Result<ScreeningReport, String> {
    let state = app.state::<ScreeningState>();
    let screening_id = {
        let mut guard = state.active_screening_id.lock().unwrap();
        guard.take()
    };

    let Some(screening_id) = screening_id else {
        return Err("No active screening".to_string());
    };

    if let Some(task) = state.recorder_task.lock().unwrap().take() {
        task.abort();
    }

    set_vision_capture_mode(0)?;
    stop_vision()?;

    let report = build_report_from_db(&app, &screening_id)?;
    let report_json = serde_json::to_string(&report).map_err(|e| e.to_string())?;
    let ended_at = Utc::now().timestamp();

    with_db(&app, |conn| {
        conn.execute(
            "UPDATE screening_sessions SET ended_at = ?1, report_json = ?2, summary_text = ?3 WHERE id = ?4",
            params![ended_at, report_json, report.summary_text, screening_id],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    })?;

    Ok(report)
}

#[tauri::command]
pub async fn get_active_screening(app: AppHandle) -> Result<Option<String>, String> {
    Ok(app
        .state::<ScreeningState>()
        .active_screening_id
        .lock()
        .unwrap()
        .clone())
}

#[tauri::command]
pub async fn list_screening_sessions(
    app: AppHandle,
    limit: i64,
) -> Result<Vec<ScreeningSessionRow>, String> {
    with_db(&app, |conn| {
        let mut stmt = conn.prepare(
            "SELECT id, started_at, ended_at, report_json, label, summary_text FROM screening_sessions
             ORDER BY started_at DESC LIMIT ?1",
        )
        .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![limit], |row| {
                Ok(ScreeningSessionRow {
                    id: row.get(0)?,
                    started_at: row.get(1)?,
                    ended_at: row.get(2)?,
                    report_json: row.get(3)?,
                    label: row.get(4)?,
                    summary_text: row.get(5)?,
                })
            })
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())
    })
}

#[tauri::command]
pub async fn get_screening_report(
    app: AppHandle,
    screening_id: String,
) -> Result<ScreeningReport, String> {
    with_db(&app, |conn| {
        let mut stmt = conn
            .prepare("SELECT report_json FROM screening_sessions WHERE id = ?1")
            .map_err(|e| e.to_string())?;
        let mut rows = stmt
            .query(params![screening_id.clone()])
            .map_err(|e| e.to_string())?;
        if let Some(row) = rows.next().map_err(|e| e.to_string())? {
            let json: Option<String> = row.get(0).map_err(|e| e.to_string())?;
            if let Some(json) = json {
                return serde_json::from_str(&json).map_err(|e| e.to_string());
            }
        }
        Err("Report not found".to_string())
    })
    .or_else(|_| build_report_from_db(&app, &screening_id))
}

#[tauri::command]
pub async fn save_screening_label(
    app: AppHandle,
    screening_id: String,
    label: i32,
    label_source: String,
) -> Result<(), String> {
    if label != 0 && label != 1 {
        return Err("Label must be 0 (typical) or 1 (ADHD indicator)".to_string());
    }
    with_db(&app, |conn| {
        conn.execute(
            "UPDATE screening_sessions SET label = ?1, label_source = ?2 WHERE id = ?3",
            params![label, label_source, screening_id],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    })
}

#[tauri::command]
pub async fn get_prior_screening_error_rate(
    app: AppHandle,
    exclude_id: String,
) -> Result<Option<f32>, String> {
    with_db(&app, |conn| {
        let mut stmt = conn.prepare(
            "SELECT report_json FROM screening_sessions
             WHERE ended_at IS NOT NULL AND id != ?1
             ORDER BY started_at DESC LIMIT 1",
        )
        .map_err(|e| e.to_string())?;
        let mut rows = stmt.query(params![exclude_id]).map_err(|e| e.to_string())?;
        if let Some(row) = rows.next().map_err(|e| e.to_string())? {
            let json: Option<String> = row.get(0).map_err(|e| e.to_string())?;
            if let Some(json) = json {
                if let Ok(report) = serde_json::from_str::<ScreeningReport>(&json) {
                    if let Some(anti) = report
                        .trial_summaries
                        .iter()
                        .find(|t| t.task_id == "antisaccade")
                    {
                        return Ok(Some(anti.error_rate));
                    }
                }
            }
        }
        Ok(None)
    })
}

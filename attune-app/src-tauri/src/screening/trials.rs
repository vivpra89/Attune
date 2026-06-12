use crate::attune_db::with_db;
use rusqlite::params;
use serde::{Deserialize, Serialize};
use tauri::AppHandle;

pub const SACCADE_VELOCITY_THRESH: f32 = 0.08;
pub const YAW_DIRECTION_THRESH: f32 = 0.045;
pub const TRIAL_WINDOW_SEC: f64 = 1.45;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrialScore {
    pub task_id: String,
    pub trial_index: u8,
    pub cue_side: String,
    pub expected_gaze_side: String,
    pub cue_onset_ts: f64,
    pub scored: bool,
    pub saccade_latency_ms: Option<f32>,
    pub direction_error: Option<bool>,
    pub anticipatory: bool,
    pub gaze_direction: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrialTaskSummary {
    pub task_id: String,
    pub trial_count: u32,
    pub scored_count: u32,
    pub error_count: u32,
    pub error_rate: f32,
    pub mean_latency_ms: f32,
    pub trials: Vec<TrialScore>,
}

type SampleRow = (f64, f32, f32, i32);

pub fn opposite_side(side: &str) -> String {
    if side == "left" {
        "right".to_string()
    } else {
        "left".to_string()
    }
}

pub fn expected_gaze_side(task_id: &str, cue_side: &str) -> String {
    if task_id == "antisaccade" {
        opposite_side(cue_side)
    } else {
        cue_side.to_string()
    }
}

pub fn gaze_direction_from_yaw(relative_yaw: f32) -> Option<String> {
    if relative_yaw < -YAW_DIRECTION_THRESH {
        Some("left".to_string())
    } else if relative_yaw > YAW_DIRECTION_THRESH {
        Some("right".to_string())
    } else {
        None
    }
}

pub fn compute_baseline_yaw(samples: &[(f64, f32, f32, f32, f32, f32, i32, f32)]) -> f32 {
    let mut yaws: Vec<f32> = samples
        .iter()
        .filter(|r| r.6 != 0 && r.4 < 0.45)
        .map(|r| r.1)
        .collect();
    if yaws.is_empty() {
        yaws = samples.iter().filter(|r| r.6 != 0).map(|r| r.1).collect();
    }
    if yaws.is_empty() {
        return 0.0;
    }
    yaws.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    yaws[yaws.len() / 2]
}

fn trial_samples<'a>(
    all: &'a [SampleRow],
    cue_onset: f64,
    window_sec: f64,
) -> Vec<&'a SampleRow> {
    all.iter()
        .filter(|r| r.0 >= cue_onset - 0.08 && r.0 <= cue_onset + window_sec)
        .collect()
}

fn detect_first_saccade(
    samples: &[&SampleRow],
    cue_onset: f64,
    baseline_yaw: f32,
) -> Option<(f32, f32, bool)> {
    if samples.len() < 2 {
        return None;
    }

    for i in 1..samples.len() {
        let prev = samples[i - 1];
        let curr = samples[i];
        if prev.3 == 0 || curr.3 == 0 {
            continue;
        }
        let dt = (curr.0 - prev.0) as f32;
        if dt <= 0.0 {
            continue;
        }
        let vel = ((curr.1 - prev.1).powi(2) + (curr.2 - prev.2).powi(2)).sqrt() / dt;
        if vel <= SACCADE_VELOCITY_THRESH {
            continue;
        }
        let rel_yaw = curr.1 - baseline_yaw;
        let latency_ms = ((curr.0 - cue_onset) * 1000.0) as f32;
        let anticipatory = curr.0 < cue_onset - 0.02;
        return Some((latency_ms.max(0.0), rel_yaw, anticipatory));
    }
    None
}

pub fn score_trial(
    task_id: &str,
    cue_side: &str,
    expected: &str,
    cue_onset: f64,
    samples: &[SampleRow],
    baseline_yaw: f32,
) -> TrialScore {
    let window_samples: Vec<&SampleRow> = trial_samples(samples, cue_onset, TRIAL_WINDOW_SEC);

    let pre_cue: Vec<&SampleRow> = window_samples
        .iter()
        .copied()
        .filter(|r| r.0 < cue_onset - 0.02 && r.3 != 0)
        .collect();
    let anticipatory = pre_cue.windows(2).any(|w| {
        let dt = (w[1].0 - w[0].0) as f32;
        if dt <= 0.0 {
            return false;
        }
        let vel = ((w[1].1 - w[0].1).powi(2) + (w[1].2 - w[0].2).powi(2)).sqrt() / dt;
        vel > SACCADE_VELOCITY_THRESH
    });

    let post_cue: Vec<&SampleRow> = window_samples
        .iter()
        .copied()
        .filter(|r| r.0 >= cue_onset && r.3 != 0)
        .collect();

    if let Some((latency_ms, rel_yaw, _)) =
        detect_first_saccade(&post_cue, cue_onset, baseline_yaw)
    {
        let gaze_direction = gaze_direction_from_yaw(rel_yaw);
        let direction_error = gaze_direction.as_ref().map(|d| {
            if task_id == "antisaccade" {
                d == cue_side
            } else {
                d != expected
            }
        });
        return TrialScore {
            task_id: task_id.to_string(),
            trial_index: 0,
            cue_side: cue_side.to_string(),
            expected_gaze_side: expected.to_string(),
            cue_onset_ts: cue_onset,
            scored: true,
            saccade_latency_ms: Some(latency_ms),
            direction_error,
            anticipatory,
            gaze_direction,
        };
    }

    TrialScore {
        task_id: task_id.to_string(),
        trial_index: 0,
        cue_side: cue_side.to_string(),
        expected_gaze_side: expected.to_string(),
        cue_onset_ts: cue_onset,
        scored: false,
        saccade_latency_ms: None,
        direction_error: None,
        anticipatory,
        gaze_direction: None,
    }
}

pub fn summarize_trials(task_id: &str, trials: &[TrialScore]) -> TrialTaskSummary {
    let scored: Vec<&TrialScore> = trials.iter().filter(|t| t.scored).collect();
    let errors = scored
        .iter()
        .filter(|t| t.direction_error == Some(true))
        .count();
    let latencies: Vec<f32> = scored
        .iter()
        .filter_map(|t| t.saccade_latency_ms)
        .collect();
    let mean_latency = if latencies.is_empty() {
        0.0
    } else {
        latencies.iter().sum::<f32>() / latencies.len() as f32
    };
    TrialTaskSummary {
        task_id: task_id.to_string(),
        trial_count: trials.len() as u32,
        scored_count: scored.len() as u32,
        error_count: errors as u32,
        error_rate: if scored.is_empty() {
            0.0
        } else {
            errors as f32 / scored.len() as f32
        },
        mean_latency_ms: mean_latency,
        trials: trials.to_vec(),
    }
}

pub fn load_and_score_trials(
    app: &AppHandle,
    screening_id: &str,
    baseline_yaw: f32,
) -> Result<Vec<TrialTaskSummary>, String> {
    let trial_rows: Vec<(i64, String, i32, String, String, f64)> = with_db(app, |conn| {
            let mut stmt = conn.prepare(
                "SELECT id, task_id, trial_index, cue_side, expected_gaze_side, cue_onset_ts
                 FROM screening_trials WHERE screening_id = ?1 ORDER BY task_id, trial_index",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![screening_id], |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                    row.get(5)?,
                ))
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        Ok(rows)
        })?;

    let sample_rows: Vec<SampleRow> = with_db(app, |conn| {
        let mut stmt = conn.prepare(
            "SELECT ts, yaw, pitch, face_present FROM screening_samples
             WHERE screening_id = ?1 ORDER BY ts ASC",
        )
        .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![screening_id], |row| {
                Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?))
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        Ok(rows)
    })?;

    let mut anti_trials = Vec::new();
    let mut pro_trials = Vec::new();
    let mut story_trials = Vec::new();

    for (id, task_id, trial_index, cue_side, expected, cue_onset) in trial_rows {
        let mut score = score_trial(
            &task_id,
            &cue_side,
            &expected,
            cue_onset,
            &sample_rows,
            baseline_yaw,
        );
        score.trial_index = trial_index as u8;

        with_db(app, |conn| {
            conn.execute(
                "UPDATE screening_trials SET scored = ?1, saccade_latency_ms = ?2,
                 direction_error = ?3, anticipatory = ?4, gaze_direction = ?5 WHERE id = ?6",
                params![
                    if score.scored { 1 } else { 0 },
                    score.saccade_latency_ms,
                    score.direction_error.map(|e| if e { 1 } else { 0 }),
                    if score.anticipatory { 1 } else { 0 },
                    score.gaze_direction,
                    id,
                ],
            )
            .map_err(|e| e.to_string())?;
            Ok(())
        })?;

        if task_id == "antisaccade" {
            anti_trials.push(score);
        } else if task_id == "prosaccade" {
            pro_trials.push(score);
        } else if task_id == "story_probe" {
            story_trials.push(score);
        }
    }

    let mut summaries = vec![
        summarize_trials("prosaccade", &pro_trials),
        summarize_trials("antisaccade", &anti_trials),
    ];
    if !story_trials.is_empty() {
        summaries.push(summarize_trials("story_probe", &story_trials));
    }
    Ok(summaries)
}

pub fn record_trial(
    app: &AppHandle,
    screening_id: &str,
    task_id: &str,
    trial_index: u8,
    cue_side: &str,
    cue_onset_ts: f64,
) -> Result<(), String> {
    let expected = expected_gaze_side(task_id, cue_side);
    with_db(app, |conn| {
        conn.execute(
            "INSERT INTO screening_trials
             (screening_id, task_id, trial_index, cue_side, expected_gaze_side, cue_onset_ts)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                screening_id,
                task_id,
                trial_index as i32,
                cue_side,
                expected,
                cue_onset_ts,
            ],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    })
}

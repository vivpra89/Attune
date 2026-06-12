use rusqlite::params;
use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use crate::attune_db::with_db;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrainingSessionSummary {
    pub id: String,
    pub started_at: i64,
    pub ended_at: Option<i64>,
    pub mission_minutes: f32,
    pub world_id: i32,
    pub steer_accuracy: Option<f32>,
    pub tap_accuracy: Option<f32>,
    pub multitask_cost: Option<f32>,
    pub gaze_engagement: Option<f32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrainingInsights {
    pub sessions_last_7_days: i32,
    pub total_minutes_last_7_days: f32,
    pub avg_steer_accuracy: Option<f32>,
    pub avg_tap_accuracy: Option<f32>,
    pub avg_multitask_cost: Option<f32>,
    pub avg_gaze_engagement: Option<f32>,
    pub trend_steer: Vec<f32>,
    pub trend_tap: Vec<f32>,
    pub trend_multitask: Vec<f32>,
    pub trend_gaze: Vec<f32>,
    pub recent_sessions: Vec<TrainingSessionSummary>,
}

pub fn list_training_sessions(
    app: &AppHandle,
    limit: i32,
) -> Result<Vec<TrainingSessionSummary>, String> {
    with_db(app, |conn| {
        let mut stmt = conn
            .prepare(
                "SELECT id, started_at, ended_at, mission_minutes, world_id,
                        steer_accuracy, tap_accuracy, multitask_cost, gaze_engagement
                 FROM training_sessions
                 ORDER BY started_at DESC LIMIT ?1",
            )
            .map_err(|e| e.to_string())?;

        let rows = stmt
            .query_map(params![limit], |row| {
                Ok(TrainingSessionSummary {
                    id: row.get(0)?,
                    started_at: row.get(1)?,
                    ended_at: row.get(2)?,
                    mission_minutes: row.get(3)?,
                    world_id: row.get(4)?,
                    steer_accuracy: row.get(5)?,
                    tap_accuracy: row.get(6)?,
                    multitask_cost: row.get(7)?,
                    gaze_engagement: row.get(8)?,
                })
            })
            .map_err(|e| e.to_string())?;

        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())
    })
}

pub fn get_training_insights(app: &AppHandle) -> Result<TrainingInsights, String> {
    let cutoff = chrono::Utc::now().timestamp() - 7 * 24 * 3600;

    with_db(app, |conn| {
        let mut stmt = conn
            .prepare(
                "SELECT id, started_at, ended_at, mission_minutes, world_id,
                        steer_accuracy, tap_accuracy, multitask_cost, gaze_engagement
                 FROM training_sessions
                 WHERE ended_at IS NOT NULL AND started_at >= ?1
                 ORDER BY started_at ASC",
            )
            .map_err(|e| e.to_string())?;

        let sessions: Vec<TrainingSessionSummary> = stmt
            .query_map(params![cutoff], |row| {
                Ok(TrainingSessionSummary {
                    id: row.get(0)?,
                    started_at: row.get(1)?,
                    ended_at: row.get(2)?,
                    mission_minutes: row.get(3)?,
                    world_id: row.get(4)?,
                    steer_accuracy: row.get(5)?,
                    tap_accuracy: row.get(6)?,
                    multitask_cost: row.get(7)?,
                    gaze_engagement: row.get(8)?,
                })
            })
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect();

        let total_minutes: f32 = sessions.iter().map(|s| s.mission_minutes).sum();

        let avg = |f: fn(&TrainingSessionSummary) -> Option<f32>| -> Option<f32> {
            let vals: Vec<f32> = sessions.iter().filter_map(f).collect();
            if vals.is_empty() {
                None
            } else {
                Some(vals.iter().sum::<f32>() / vals.len() as f32)
            }
        };

        let trend = |f: fn(&TrainingSessionSummary) -> Option<f32>| -> Vec<f32> {
            sessions.iter().filter_map(f).collect()
        };

        let mut recent_stmt = conn
            .prepare(
                "SELECT id, started_at, ended_at, mission_minutes, world_id,
                        steer_accuracy, tap_accuracy, multitask_cost, gaze_engagement
                 FROM training_sessions
                 ORDER BY started_at DESC LIMIT 10",
            )
            .map_err(|e| e.to_string())?;
        let recent: Vec<TrainingSessionSummary> = recent_stmt
            .query_map([], |row| {
                Ok(TrainingSessionSummary {
                    id: row.get(0)?,
                    started_at: row.get(1)?,
                    ended_at: row.get(2)?,
                    mission_minutes: row.get(3)?,
                    world_id: row.get(4)?,
                    steer_accuracy: row.get(5)?,
                    tap_accuracy: row.get(6)?,
                    multitask_cost: row.get(7)?,
                    gaze_engagement: row.get(8)?,
                })
            })
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect();

        Ok(TrainingInsights {
            sessions_last_7_days: sessions.len() as i32,
            total_minutes_last_7_days: total_minutes,
            avg_steer_accuracy: avg(|s| s.steer_accuracy),
            avg_tap_accuracy: avg(|s| s.tap_accuracy),
            avg_multitask_cost: avg(|s| s.multitask_cost),
            avg_gaze_engagement: avg(|s| s.gaze_engagement),
            trend_steer: trend(|s| s.steer_accuracy),
            trend_tap: trend(|s| s.tap_accuracy),
            trend_multitask: trend(|s| s.multitask_cost),
            trend_gaze: trend(|s| s.gaze_engagement),
            recent_sessions: recent,
        })
    })
}

use chrono::{Local, NaiveDate};
use rusqlite::params;
use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use crate::attune_db::with_db;

pub const DEFAULT_DAILY_MINUTES: f32 = 25.0;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrainingCompliance {
    pub date: String,
    pub minutes_played: f32,
    pub minutes_remaining: f32,
    pub daily_budget_minutes: f32,
    pub missions_completed: i32,
    pub locked_out: bool,
    pub streak_days: i32,
    pub missed_yesterday: bool,
}

fn today_str() -> String {
    Local::now().format("%Y-%m-%d").to_string()
}

pub fn load_daily_budget_minutes(app: &AppHandle) -> f32 {
    with_db(app, |conn| {
        let mut stmt = conn
            .prepare("SELECT value FROM attune_settings WHERE key = 'training_daily_minutes'")
            .map_err(|e| e.to_string())?;
        let mut rows = stmt.query([]).map_err(|e| e.to_string())?;
        if let Some(row) = rows.next().map_err(|e| e.to_string())? {
            let v: String = row.get(0).map_err(|e| e.to_string())?;
            return Ok(v.parse().unwrap_or(DEFAULT_DAILY_MINUTES));
        }
        Ok(DEFAULT_DAILY_MINUTES)
    })
    .unwrap_or(DEFAULT_DAILY_MINUTES)
}

fn ensure_compliance_row(conn: &rusqlite::Connection, date: &str) -> Result<(), String> {
    conn.execute(
        "INSERT OR IGNORE INTO training_daily_compliance (date, minutes_played, missions_completed, locked_out)
         VALUES (?1, 0, 0, 0)",
        params![date],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn add_mission_minutes(
    app: &AppHandle,
    minutes: f32,
) -> Result<TrainingCompliance, String> {
    let date = today_str();
    let budget = load_daily_budget_minutes(app);

    with_db(app, |conn| {
        ensure_compliance_row(conn, &date)?;
        conn.execute(
            "UPDATE training_daily_compliance
             SET minutes_played = minutes_played + ?1,
                 missions_completed = missions_completed + 1,
                 locked_out = CASE WHEN minutes_played + ?1 >= ?2 THEN 1 ELSE locked_out END
             WHERE date = ?3",
            params![minutes, budget, date],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    })?;

    get_training_compliance(app)
}

pub fn compute_streak(conn: &rusqlite::Connection) -> Result<i32, String> {
    let mut stmt = conn
        .prepare(
            "SELECT date, minutes_played FROM training_daily_compliance
             WHERE minutes_played > 0
             ORDER BY date DESC LIMIT 60",
        )
        .map_err(|e| e.to_string())?;

    let rows: Vec<(String, f32)> = stmt
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    if rows.is_empty() {
        return Ok(0);
    }

    let today = today_str();
    let yesterday = (Local::now() - chrono::Duration::days(1))
        .format("%Y-%m-%d")
        .to_string();

    let mut streak = 0i32;
    let mut check_date = if rows.iter().any(|(d, _)| d == &today) {
        NaiveDate::parse_from_str(&today, "%Y-%m-%d").map_err(|e| e.to_string())?
    } else if rows.iter().any(|(d, _)| d == &yesterday) {
        NaiveDate::parse_from_str(&yesterday, "%Y-%m-%d").map_err(|e| e.to_string())?
    } else {
        return Ok(0);
    };

    loop {
        let ds = check_date.format("%Y-%m-%d").to_string();
        if let Some((_, mins)) = rows.iter().find(|(d, _)| d == &ds) {
            if *mins > 0.0 {
                streak += 1;
                check_date = check_date
                    .pred_opt()
                    .ok_or_else(|| "Date underflow".to_string())?;
                continue;
            }
        }
        break;
    }

    Ok(streak)
}

pub fn get_training_compliance(app: &AppHandle) -> Result<TrainingCompliance, String> {
    let date = today_str();
    let budget = load_daily_budget_minutes(app);
    let yesterday = (Local::now() - chrono::Duration::days(1))
        .format("%Y-%m-%d")
        .to_string();

    with_db(app, |conn| {
        ensure_compliance_row(conn, &date)?;

        let mut stmt = conn
            .prepare(
                "SELECT minutes_played, missions_completed, locked_out
                 FROM training_daily_compliance WHERE date = ?1",
            )
            .map_err(|e| e.to_string())?;
        let row = stmt
            .query_row(params![date], |row| {
                Ok((
                    row.get::<_, f32>(0)?,
                    row.get::<_, i32>(1)?,
                    row.get::<_, i32>(2)?,
                ))
            })
            .map_err(|e| e.to_string())?;

        let (minutes_played, missions_completed, locked_out) = row;
        let locked = locked_out != 0 || minutes_played >= budget;
        let minutes_remaining = (budget - minutes_played).max(0.0);
        let streak = compute_streak(conn)?;

        let missed_yesterday = conn
            .query_row(
                "SELECT COALESCE(minutes_played, 0) FROM training_daily_compliance WHERE date = ?1",
                params![yesterday],
                |r| r.get::<_, f32>(0),
            )
            .unwrap_or(0.0)
            < budget * 0.5;

        Ok(TrainingCompliance {
            date,
            minutes_played,
            minutes_remaining,
            daily_budget_minutes: budget,
            missions_completed,
            locked_out: locked,
            streak_days: streak,
            missed_yesterday,
        })
    })
}

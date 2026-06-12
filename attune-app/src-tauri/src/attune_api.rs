use crate::attune_db::with_db;
use crate::session::{AppFocusPoint, AttentionPoint, SessionSummary};
use rusqlite::params;
use serde::{Deserialize, Serialize};
use tauri::AppHandle;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum LlmProvider {
    Claude,
    Openai,
}

impl LlmProvider {
    fn from_setting(value: &str) -> Self {
        match value.trim().to_lowercase().as_str() {
            "openai" => Self::Openai,
            _ => Self::Claude,
        }
    }

    fn label(self) -> &'static str {
        match self {
            Self::Claude => "Claude",
            Self::Openai => "OpenAI",
        }
    }
}

fn get_llm_provider(app: &AppHandle) -> LlmProvider {
    with_db(app, |conn| {
        let mut stmt = conn
            .prepare("SELECT value FROM attune_settings WHERE key = 'llm_provider'")
            .map_err(|e| e.to_string())?;
        let mut rows = stmt.query([]).map_err(|e| e.to_string())?;
        if let Some(row) = rows.next().map_err(|e| e.to_string())? {
            let v: String = row.get(0).map_err(|e| e.to_string())?;
            return Ok(LlmProvider::from_setting(&v));
        }
        Ok(LlmProvider::Claude)
    })
    .unwrap_or(LlmProvider::Claude)
}

fn get_claude_api_key(app: &AppHandle) -> Result<String, String> {
    with_db(app, |conn| {
        let mut stmt = conn
            .prepare("SELECT value FROM attune_settings WHERE key = 'claude_api_key'")
            .map_err(|e| e.to_string())?;
        let mut rows = stmt.query([]).map_err(|e| e.to_string())?;
        if let Some(row) = rows.next().map_err(|e| e.to_string())? {
            let key: String = row.get(0).map_err(|e| e.to_string())?;
            if !key.is_empty() {
                return Ok(key);
            }
        }
        Err("Claude API key not configured. Add it in Parent Settings.".to_string())
    })
}

fn get_openai_api_key(app: &AppHandle) -> Result<String, String> {
    with_db(app, |conn| {
        let mut stmt = conn
            .prepare("SELECT value FROM attune_settings WHERE key = 'openai_api_key'")
            .map_err(|e| e.to_string())?;
        let mut rows = stmt.query([]).map_err(|e| e.to_string())?;
        if let Some(row) = rows.next().map_err(|e| e.to_string())? {
            let key: String = row.get(0).map_err(|e| e.to_string())?;
            if !key.is_empty() {
                return Ok(key);
            }
        }
        Err("OpenAI API key not configured. Add it in Parent Settings.".to_string())
    })
}

async fn call_claude(api_key: &str, system: &str, user: &str) -> Result<String, String> {
    let client = reqwest::Client::new();

    let body = serde_json::json!({
        "model": "claude-sonnet-4-20250514",
        "max_tokens": 1024,
        "system": system,
        "messages": [
            { "role": "user", "content": user }
        ]
    });

    let response = client
        .post("https://api.anthropic.com/v1/messages")
        .header("x-api-key", api_key)
        .header("anthropic-version", "2023-06-01")
        .header("content-type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Claude API request failed: {e}"))?;

    if !response.status().is_success() {
        let text = response.text().await.unwrap_or_default();
        return Err(format!("Claude API error: {text}"));
    }

    let json: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse Claude response: {e}"))?;

    json["content"]
        .as_array()
        .and_then(|arr| arr.first())
        .and_then(|block| block["text"].as_str())
        .map(String::from)
        .ok_or_else(|| "Unexpected Claude response format".to_string())
}

async fn call_openai(api_key: &str, system: &str, user: &str) -> Result<String, String> {
    let client = reqwest::Client::new();

    let body = serde_json::json!({
        "model": "gpt-4o-mini",
        "max_tokens": 1024,
        "messages": [
            { "role": "system", "content": system },
            { "role": "user", "content": user }
        ]
    });

    let response = client
        .post("https://api.openai.com/v1/chat/completions")
        .header("Authorization", format!("Bearer {api_key}"))
        .header("content-type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("OpenAI API request failed: {e}"))?;

    if !response.status().is_success() {
        let text = response.text().await.unwrap_or_default();
        return Err(format!("OpenAI API error: {text}"));
    }

    let json: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse OpenAI response: {e}"))?;

    json["choices"]
        .as_array()
        .and_then(|arr| arr.first())
        .and_then(|choice| choice["message"]["content"].as_str())
        .map(String::from)
        .ok_or_else(|| "Unexpected OpenAI response format".to_string())
}

async fn call_llm(app: &AppHandle, system: &str, user: &str) -> Result<String, String> {
    match get_llm_provider(app) {
        LlmProvider::Claude => {
            let api_key = get_claude_api_key(app)?;
            call_claude(&api_key, system, user).await
        }
        LlmProvider::Openai => {
            let api_key = get_openai_api_key(app)?;
            call_openai(&api_key, system, user).await
        }
    }
}

#[derive(Debug, Serialize, Deserialize)]
struct DistractionAggregate {
    kind: String,
    count: i64,
    avg_severity: f32,
}

#[derive(Debug, Serialize, Deserialize)]
struct SessionAnalytics {
    avg_engagement: f32,
    avg_gaze_away: f32,
    model_version: String,
    distraction_breakdown: Vec<DistractionAggregate>,
    task_switch_events: i64,
    off_task_events: i64,
    emotional_overload_events: i64,
    top_apps: Vec<String>,
}

fn compute_session_analytics(app: &AppHandle, session_id: &str) -> Result<SessionAnalytics, String> {
    with_db(app, |conn| {
        let avg_engagement: f32 = conn
            .query_row(
                "SELECT AVG(engagement) FROM ml_inference_samples WHERE session_id = ?1",
                params![session_id],
                |row| row.get(0),
            )
            .unwrap_or(0.0);

        let avg_gaze: f32 = conn
            .query_row(
                "SELECT AVG(gaze_away) FROM ml_inference_samples WHERE session_id = ?1",
                params![session_id],
                |row| row.get(0),
            )
            .unwrap_or(0.0);

        let model_version: String = conn
            .query_row(
                "SELECT model_version FROM ml_inference_samples WHERE session_id = ?1 ORDER BY ts DESC LIMIT 1",
                params![session_id],
                |row| row.get(0),
            )
            .unwrap_or_else(|_| "unknown".to_string());

        let mut dist_stmt = conn
            .prepare(
                "SELECT kind, COUNT(*), AVG(severity) FROM distraction_events WHERE session_id = ?1 GROUP BY kind",
            )
            .map_err(|e| e.to_string())?;
        let breakdown: Vec<DistractionAggregate> = dist_stmt
            .query_map(params![session_id], |row| {
                Ok(DistractionAggregate {
                    kind: row.get(0)?,
                    count: row.get(1)?,
                    avg_severity: row.get(2)?,
                })
            })
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect();

        let task_switch = breakdown
            .iter()
            .find(|d| d.kind == "task_switching")
            .map(|d| d.count)
            .unwrap_or(0);
        let off_task = breakdown
            .iter()
            .find(|d| d.kind == "off_task_app")
            .map(|d| d.count)
            .unwrap_or(0);
        let emotional = breakdown
            .iter()
            .find(|d| d.kind == "emotional_overload")
            .map(|d| d.count)
            .unwrap_or(0);

        let mut app_stmt = conn
            .prepare(
                "SELECT app_name, SUM(duration_sec) as total FROM app_focus_events WHERE session_id = ?1 GROUP BY app_name ORDER BY total DESC LIMIT 5",
            )
            .map_err(|e| e.to_string())?;
        let top_apps: Vec<String> = app_stmt
            .query_map(params![session_id], |row| {
                let name: String = row.get(0)?;
                let total: i64 = row.get(1)?;
                Ok(format!("{name} ({total}s)"))
            })
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect();

        Ok(SessionAnalytics {
            avg_engagement,
            avg_gaze_away: avg_gaze,
            model_version,
            distraction_breakdown: breakdown,
            task_switch_events: task_switch,
            off_task_events: off_task,
            emotional_overload_events: emotional,
            top_apps,
        })
    })
}

pub async fn generate_session_summary(app: AppHandle, session_id: String) -> Result<String, String> {
    let (scores, apps): (Vec<AttentionPoint>, Vec<AppFocusPoint>) = with_db(&app, |conn| {
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

        Ok((scores, apps))
    })?;

    if scores.is_empty() {
        return Ok("No attention data recorded for this session.".to_string());
    }

    let analytics = compute_session_analytics(&app, &session_id).unwrap_or(SessionAnalytics {
        avg_engagement: 0.0,
        avg_gaze_away: 0.0,
        model_version: "unknown".to_string(),
        distraction_breakdown: vec![],
        task_switch_events: 0,
        off_task_events: 0,
        emotional_overload_events: 0,
        top_apps: vec![],
    });

    let avg: f32 = scores.iter().map(|s| s.score).sum::<f32>() / scores.len() as f32;
    let low_points = scores.iter().filter(|s| s.score < 50.0).count();

    let emotion_summary: String = with_db(&app, |conn| {
        let mut stmt = conn
            .prepare(
                "SELECT emotion, COUNT(*) FROM attention_samples WHERE session_id = ?1 AND emotion IS NOT NULL AND emotion != '' GROUP BY emotion",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![session_id.clone()], |row| {
                let emotion: String = row.get(0)?;
                let count: i64 = row.get(1)?;
                Ok(format!("{emotion}: {count}s"))
            })
            .map_err(|e| e.to_string())?;
        let parts: Result<Vec<_>, _> = rows.collect();
        Ok(parts.unwrap_or_default().join(", "))
    })
    .unwrap_or_default();

    let distraction_summary: String = analytics
        .distraction_breakdown
        .iter()
        .map(|d| format!("{}: {} events (avg severity {:.0}%)", d.kind, d.count, d.avg_severity * 100.0))
        .collect::<Vec<_>>()
        .join(", ");

    let app_summary: Vec<String> = apps
        .iter()
        .map(|a| format!("{} ({}s)", a.app_name, a.duration_sec))
        .collect();

    let child_name = crate::session::get_setting(app.clone(), "child_name".to_string())
        .await
        .ok()
        .flatten()
        .unwrap_or_else(|| "your child".to_string());

    let user_prompt = format!(
        "Session data for {child_name}:\n\
         - Average attention score: {avg:.0}/100\n\
         - ML avg engagement: {:.0}%\n\
         - ML avg gaze-away: {:.0}%\n\
         - Model version: {}\n\
         - Low-attention samples: {low_points} of {}\n\
         - Emotion distribution (sample counts): {}\n\
         - Distraction patterns: {}\n\
         - Task switching events: {}\n\
         - Off-task app events: {}\n\
         - Emotional overload events: {}\n\
         - Top apps by dwell: {}\n\
         - Apps used: {}\n\
         - Score timeline (ts:score): {}\n\n\
         Write a warm, parent-friendly summary (3-4 short paragraphs). \
         Mention what held attention, when engagement dipped, distraction patterns, and one practical suggestion. \
         No medical claims. Plain English.",
        analytics.avg_engagement * 100.0,
        analytics.avg_gaze_away * 100.0,
        analytics.model_version,
        scores.len(),
        if emotion_summary.is_empty() {
            "not recorded".to_string()
        } else {
            emotion_summary
        },
        if distraction_summary.is_empty() {
            "none detected".to_string()
        } else {
            distraction_summary
        },
        analytics.task_switch_events,
        analytics.off_task_events,
        analytics.emotional_overload_events,
        if analytics.top_apps.is_empty() {
            "unknown".to_string()
        } else {
            analytics.top_apps.join(", ")
        },
        if app_summary.is_empty() {
            "unknown (accessibility permission may be off)".to_string()
        } else {
            app_summary.join(", ")
        },
        scores
            .iter()
            .take(60)
            .map(|s| format!("{}:{:.0}", s.ts, s.score))
            .collect::<Vec<_>>()
            .join(", ")
    );

    call_llm(
        &app,
        "You are Attune, an assistant that helps parents understand their child's learning attention patterns. Be supportive, concise, and never shame the child.",
        &user_prompt,
    )
    .await
}

pub async fn generate_weekly_report(
    app: AppHandle,
    sessions: Vec<SessionSummary>,
) -> Result<String, String> {
    let summaries: Vec<String> = sessions
        .iter()
        .filter_map(|s| {
            s.summary_text.as_ref().map(|t| {
                format!(
                    "Session {}: avg {:.0}, summary: {}",
                    s.id,
                    s.avg_score.unwrap_or(0.0),
                    t
                )
            })
        })
        .collect();

    let user_prompt = format!(
        "Weekly learning attention report based on {} sessions:\n\n{}\n\n\
         Write a weekly progress report for a parent (4-5 paragraphs). \
         Highlight trends, improvements, content that worked well, and 2 actionable tips for next week.",
        sessions.len(),
        summaries.join("\n\n")
    );

    call_llm(
        &app,
        "You are Attune generating a weekly parent report about a child's learning attention. Be encouraging and practical.",
        &user_prompt,
    )
    .await
}

#[tauri::command]
pub async fn generate_screening_summary(
    app: AppHandle,
    screening_id: String,
) -> Result<String, String> {
    let report = crate::screening::get_screening_report(app.clone(), screening_id.clone()).await?;

    let insight_lines: Vec<String> = report
        .insights
        .iter()
        .map(|i| {
            format!(
                "- {} | {} | {} | evidence: {}={:.3} | confounders: {}",
                i.construct,
                i.headline,
                i.what_we_saw,
                i.evidence.metric,
                i.evidence.observed_value,
                i.possible_contributors.join("; ")
            )
        })
        .collect();

    let anti = report
        .trial_summaries
        .iter()
        .find(|t| t.task_id == "antisaccade");
    let anti_line = anti
        .map(|t| {
            format!(
                "Antisaccade: {}/{} scored, error rate {:.0}%, mean latency {:.0}ms",
                t.error_count,
                t.scored_count,
                t.error_rate * 100.0,
                t.mean_latency_ms
            )
        })
        .unwrap_or_else(|| "Antisaccade: no trial data".to_string());

    let user_prompt = format!(
        "Screening report (attention-pattern aid, NOT diagnosis) for age {}:\n\
         Data quality: {} (face {:.0}%, model: {})\n\
         Deterministic summary already generated:\n{}\n\n\
         Structured insights:\n{}\n\
         {}\n\n\
         Write a warm, parent-friendly narrative (3-4 short paragraphs) that EXPLAINS WHY \
         the results look this way using ONLY the evidence above. \
         For each pattern, connect the task (fixation/prosaccade/antisaccade) to what it \
         measures (sustained attention, orienting, inhibition). \
         Mention confounders. Never diagnose ADHD. Never mention brainwaves or neurofeedback. \
         End with one practical next step.",
        report.child_age,
        report.quality.overall,
        report.quality.face_present_ratio * 100.0,
        report.quality.model_version,
        report.summary_text,
        if insight_lines.is_empty() {
            "No notable patterns.".to_string()
        } else {
            insight_lines.join("\n")
        },
        anti_line,
    );

    let narrative = call_llm(
        &app,
        "You are Attune, explaining oculomotor attention screening results to a parent. \
         Be transparent, evidence-based, and never make medical claims.",
        &user_prompt,
    )
    .await?;

    with_db(&app, |conn| {
        conn.execute(
            "UPDATE screening_sessions SET summary_text = ?1 WHERE id = ?2",
            params![narrative, screening_id],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    })?;

    Ok(narrative)
}

#[derive(Serialize)]
pub struct LlmSettingsStatus {
    pub provider: String,
    pub provider_label: String,
    pub claude_configured: bool,
    pub openai_configured: bool,
}

#[tauri::command]
pub async fn get_llm_settings(app: AppHandle) -> Result<LlmSettingsStatus, String> {
    let provider = get_llm_provider(&app);
    let claude_configured = get_claude_api_key(&app).is_ok();
    let openai_configured = get_openai_api_key(&app).is_ok();
    Ok(LlmSettingsStatus {
        provider: match provider {
            LlmProvider::Claude => "claude".to_string(),
            LlmProvider::Openai => "openai".to_string(),
        },
        provider_label: provider.label().to_string(),
        claude_configured,
        openai_configured,
    })
}

#[tauri::command]
pub async fn save_claude_api_key(app: AppHandle, api_key: String) -> Result<(), String> {
    with_db(&app, |conn| {
        conn.execute(
            "INSERT OR REPLACE INTO attune_settings (key, value) VALUES ('claude_api_key', ?1)",
            params![api_key],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    })
}

#[tauri::command]
pub async fn save_openai_api_key(app: AppHandle, api_key: String) -> Result<(), String> {
    with_db(&app, |conn| {
        conn.execute(
            "INSERT OR REPLACE INTO attune_settings (key, value) VALUES ('openai_api_key', ?1)",
            params![api_key],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    })
}

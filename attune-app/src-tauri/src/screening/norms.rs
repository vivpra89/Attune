use serde::Deserialize;

#[derive(Debug, Clone, Deserialize)]
pub struct NormTriple {
    pub p25: f32,
    pub p50: f32,
    pub p75: f32,
}

#[derive(Debug, Clone, Deserialize)]
pub struct AgeBand {
    pub min_age: u8,
    pub max_age: u8,
    pub antisaccade_error_rate: NormTriple,
    pub prosaccade_latency_ms: NormTriple,
    pub fixation_on_target_pct: NormTriple,
    pub fixation_duration_ms: NormTriple,
    pub gaze_yaw_std: NormTriple,
    pub story_on_screen_pct: NormTriple,
    pub story_gaze_variability: NormTriple,
    pub story_probe_follow_rate: NormTriple,
    pub story_vigilance_decay_pct: NormTriple,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ScreeningNorms {
    pub disclaimer: String,
    pub bands: Vec<AgeBand>,
}

pub fn load_norms() -> ScreeningNorms {
    serde_json::from_str(include_str!("../../resources/screening_norms.json"))
        .expect("screening_norms.json must be valid")
}

pub fn band_for_age(norms: &ScreeningNorms, age: u8) -> &AgeBand {
    norms
        .bands
        .iter()
        .find(|b| age >= b.min_age && age <= b.max_age)
        .unwrap_or(norms.bands.last().expect("norms must have bands"))
}

pub fn parse_child_age(app: &tauri::AppHandle) -> u8 {
    crate::attune_db::with_db(app, |conn| {
        let mut stmt = conn
            .prepare("SELECT value FROM attune_settings WHERE key = 'child_age'")
            .map_err(|e| e.to_string())?;
        let mut rows = stmt.query([]).map_err(|e| e.to_string())?;
        if let Some(row) = rows.next().map_err(|e| e.to_string())? {
            let v: String = row.get(0).map_err(|e| e.to_string())?;
            if let Ok(age) = v.parse::<u8>() {
                if (5..=99).contains(&age) {
                    return Ok(age);
                }
            }
        }
        Ok(10u8)
    })
    .unwrap_or(10)
}

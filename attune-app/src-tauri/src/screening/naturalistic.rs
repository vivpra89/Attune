use serde::{Deserialize, Serialize};

type SampleRow = (f64, f32, f32, f32, i32, f32);

const GAZE_ON_SCREEN_THRESH: f32 = 0.45;
const LAPSE_GAZE_AWAY_THRESH: f32 = 0.6;
const LAPSE_MIN_SEC: f64 = 2.0;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NaturalisticFeatureSet {
    pub task_id: String,
    pub sample_count: usize,
    pub face_present_ratio: f32,
    pub on_screen_pct: f32,
    pub gaze_variability: f32,
    pub engagement_mean: f32,
    pub vigilance_decay: f32,
    pub lapse_episodes: u32,
}

fn std_dev(values: &[f32]) -> f32 {
    if values.len() < 2 {
        return 0.0;
    }
    let mean = values.iter().sum::<f32>() / values.len() as f32;
    let var = values.iter().map(|v| (v - mean).powi(2)).sum::<f32>() / values.len() as f32;
    var.sqrt()
}

fn on_screen_pct(rows: &[SampleRow]) -> f32 {
    let present: Vec<_> = rows.iter().filter(|r| r.4 != 0).collect();
    if present.is_empty() {
        return 0.0;
    }
    present
        .iter()
        .filter(|r| r.3 < GAZE_ON_SCREEN_THRESH)
        .count() as f32
        / present.len() as f32
        * 100.0
}

fn count_lapse_episodes(rows: &[SampleRow]) -> u32 {
    let mut lapses = 0u32;
    let mut lapse_start: Option<f64> = None;

    for row in rows {
        if row.4 == 0 {
            lapse_start = None;
            continue;
        }
        if row.3 > LAPSE_GAZE_AWAY_THRESH {
            if lapse_start.is_none() {
                lapse_start = Some(row.0);
            } else if row.0 - lapse_start.unwrap() >= LAPSE_MIN_SEC {
                lapses += 1;
                lapse_start = None;
            }
        } else {
            lapse_start = None;
        }
    }
    lapses
}

pub fn compute_naturalistic_features(rows: &[SampleRow]) -> NaturalisticFeatureSet {
    if rows.is_empty() {
        return NaturalisticFeatureSet {
            task_id: "naturalistic_viewing".to_string(),
            sample_count: 0,
            face_present_ratio: 0.0,
            on_screen_pct: 0.0,
            gaze_variability: 0.0,
            engagement_mean: 0.0,
            vigilance_decay: 0.0,
            lapse_episodes: 0,
        };
    }

    let n = rows.len() as f32;
    let face_present_ratio = rows.iter().filter(|r| r.4 != 0).count() as f32 / n.max(1.0);
    let on_screen = on_screen_pct(rows);

    let yaws: Vec<f32> = rows
        .iter()
        .filter(|r| r.4 != 0)
        .map(|r| r.1)
        .collect();
    let gaze_variability = std_dev(&yaws);

    let engagement_samples: Vec<f32> = rows
        .iter()
        .filter(|r| r.4 != 0)
        .map(|r| r.5)
        .collect();
    let engagement_mean = if engagement_samples.is_empty() {
        0.0
    } else {
        engagement_samples.iter().sum::<f32>() / engagement_samples.len() as f32
    };

    let mid_ts = (rows.first().map(|r| r.0).unwrap_or(0.0) + rows.last().map(|r| r.0).unwrap_or(0.0))
        / 2.0;
    let first_half: Vec<SampleRow> = rows.iter().copied().filter(|r| r.0 <= mid_ts).collect();
    let second_half: Vec<SampleRow> = rows.iter().copied().filter(|r| r.0 > mid_ts).collect();
    let vigilance_decay = on_screen_pct(&second_half) - on_screen_pct(&first_half);

    NaturalisticFeatureSet {
        task_id: "naturalistic_viewing".to_string(),
        sample_count: rows.len(),
        face_present_ratio,
        on_screen_pct: on_screen,
        gaze_variability,
        engagement_mean,
        vigilance_decay,
        lapse_episodes: count_lapse_episodes(rows),
    }
}

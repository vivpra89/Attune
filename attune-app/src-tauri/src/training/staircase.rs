use serde::{Deserialize, Serialize};

pub const TARGET_ACCURACY: f32 = 0.80;
pub const HIGH_THRESHOLD: f32 = 0.82;
pub const LOW_THRESHOLD: f32 = 0.78;

pub const MIN_STEER_SPEED: f32 = 0.6;
pub const MAX_STEER_SPEED: f32 = 2.5;
pub const MIN_TARGET_RATE: f32 = 0.35;
pub const MAX_TARGET_RATE: f32 = 1.4;
pub const MIN_DISTRACTOR_RATIO: f32 = 0.15;
pub const MAX_DISTRACTOR_RATIO: f32 = 0.65;
pub const MAX_RULE_COMPLEXITY: u8 = 3;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DifficultyState {
    pub steer_speed: f32,
    pub target_rate: f32,
    pub distractor_ratio: f32,
    pub rule_complexity: u8,
}

impl Default for DifficultyState {
    fn default() -> Self {
        Self {
            steer_speed: 1.0,
            target_rate: 0.55,
            distractor_ratio: 0.30,
            rule_complexity: 1,
        }
    }
}

impl DifficultyState {
    pub fn from_screening_seed(antisaccade_error_rate: Option<f32>, vigilance_decay: Option<f32>) -> Self {
        let mut d = Self::default();
        if let Some(err) = antisaccade_error_rate {
            let factor = (1.0 - err.clamp(0.0, 0.8)).max(0.3);
            d.steer_speed *= factor;
            d.target_rate *= factor;
            d.distractor_ratio = (d.distractor_ratio * factor).max(MIN_DISTRACTOR_RATIO);
        }
        if let Some(decay) = vigilance_decay {
            // Negative decay = on-screen attention dropped during story viewing
            if decay < -5.0 {
                let factor = (1.0 + decay / 50.0).clamp(0.5, 1.0);
                d.steer_speed *= factor;
                d.target_rate *= factor;
            }
        }
        d.clamp();
        d
    }

    pub fn clamp(&mut self) {
        self.steer_speed = self.steer_speed.clamp(MIN_STEER_SPEED, MAX_STEER_SPEED);
        self.target_rate = self.target_rate.clamp(MIN_TARGET_RATE, MAX_TARGET_RATE);
        self.distractor_ratio = self
            .distractor_ratio
            .clamp(MIN_DISTRACTOR_RATIO, MAX_DISTRACTOR_RATIO);
        self.rule_complexity = self.rule_complexity.clamp(1, MAX_RULE_COMPLEXITY);
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RunMetrics {
    pub phase: String,
    pub steer_accuracy: f32,
    pub tap_accuracy: f32,
    pub multitask_cost: f32,
    pub mean_rt_ms: f32,
    pub gaze_engagement: f32,
    pub steer_attempts: u32,
    pub tap_attempts: u32,
}

impl RunMetrics {
    pub fn steer_effective_accuracy(&self) -> f32 {
        if self.steer_attempts == 0 {
            return TARGET_ACCURACY;
        }
        self.steer_accuracy
    }

    pub fn tap_effective_accuracy(&self) -> f32 {
        if self.tap_attempts == 0 {
            return TARGET_ACCURACY;
        }
        self.tap_accuracy
    }
}

pub fn adjust_difficulty(state: &mut DifficultyState, metrics: &RunMetrics) {
    let steer_acc = metrics.steer_effective_accuracy();
    let tap_acc = metrics.tap_effective_accuracy();

    if metrics.steer_attempts > 0 {
        if steer_acc > HIGH_THRESHOLD {
            state.steer_speed = (state.steer_speed + 0.12).min(MAX_STEER_SPEED);
        } else if steer_acc < LOW_THRESHOLD {
            state.steer_speed = (state.steer_speed - 0.12).max(MIN_STEER_SPEED);
        }
    }

    if metrics.tap_attempts > 0 {
        if tap_acc > HIGH_THRESHOLD {
            state.target_rate = (state.target_rate + 0.08).min(MAX_TARGET_RATE);
            state.distractor_ratio = (state.distractor_ratio + 0.04).min(MAX_DISTRACTOR_RATIO);
            if tap_acc > 0.88 && state.rule_complexity < MAX_RULE_COMPLEXITY {
                state.rule_complexity += 1;
            }
        } else if tap_acc < LOW_THRESHOLD {
            state.target_rate = (state.target_rate - 0.08).max(MIN_TARGET_RATE);
            state.distractor_ratio = (state.distractor_ratio - 0.04).max(MIN_DISTRACTOR_RATIO);
        }
    }

    if metrics.phase == "multitask" && metrics.multitask_cost > 0.25 {
        state.steer_speed = (state.steer_speed - 0.06).max(MIN_STEER_SPEED);
        state.target_rate = (state.target_rate - 0.04).max(MIN_TARGET_RATE);
    }

    if metrics.gaze_engagement < 0.55 && metrics.gaze_engagement > 0.0 {
        state.steer_speed = (state.steer_speed - 0.04).max(MIN_STEER_SPEED);
    }

    state.clamp();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn increases_difficulty_on_high_accuracy() {
        let mut state = DifficultyState::default();
        let before = state.steer_speed;
        adjust_difficulty(
            &mut state,
            &RunMetrics {
                phase: "steer".to_string(),
                steer_accuracy: 0.90,
                tap_accuracy: 0.80,
                multitask_cost: 0.0,
                mean_rt_ms: 400.0,
                gaze_engagement: 0.85,
                steer_attempts: 20,
                tap_attempts: 0,
            },
        );
        assert!(state.steer_speed > before);
    }

    #[test]
    fn decreases_on_low_accuracy() {
        let mut state = DifficultyState::default();
        let before = state.target_rate;
        adjust_difficulty(
            &mut state,
            &RunMetrics {
                phase: "tap".to_string(),
                steer_accuracy: 0.80,
                tap_accuracy: 0.65,
                multitask_cost: 0.0,
                mean_rt_ms: 600.0,
                gaze_engagement: 0.80,
                steer_attempts: 0,
                tap_attempts: 15,
            },
        );
        assert!(state.target_rate < before);
    }
}

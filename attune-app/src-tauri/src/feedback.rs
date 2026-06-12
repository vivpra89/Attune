use crate::distraction::{DistractionKind, DistractionState};
use crate::vision::{AttentionSample, EmotionLabel};
use serde::Serialize;

/// Gaze must exceed this to count as looking away (enter).
const GAZE_AWAY_ENTER: f32 = 0.46;
/// Gaze must drop below this to count as re-engaged (exit) — hysteresis band in between.
const GAZE_AWAY_EXIT: f32 = 0.34;
/// Sustained good gaze required before clearing dim / showing re-engage.
const GAZE_RECOVERY_HOLD_SECS: f64 = 2.0;
/// After returning to focused, ignore brief gaze flicker before dimming again.
const REENTRY_GRACE_SECS: f64 = 3.0;
/// Minimum gap between re-engage pulses.
const REENGAGE_COOLDOWN_SECS: f64 = 10.0;
/// Sustained face visible before focused after a face-absent escalation.
const FACE_RECOVERY_HOLD_SECS: f64 = 2.0;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum FeedbackState {
    Focused,
    SoftNudge,
    Dimmed,
    BreakSuggest,
    ConfusionHelp,
    HyperfocusRedirect,
}

#[derive(Debug, Clone, Serialize)]
pub struct FeedbackUpdate {
    pub state: FeedbackState,
    pub opacity: f32,
    pub smoothed_score: f32,
    pub effective_score: f32,
    pub emotion: String,
    pub child_message: String,
    pub show_reengage: bool,
    pub show_break_prompt: bool,
    pub show_confusion_help: bool,
    pub primary_distraction: Option<String>,
    pub face_missing_secs: f32,
}

#[derive(Debug, Clone, Copy)]
pub struct FeedbackProfile {
    pub ramp_per_sec: f32,
    pub nudge_after_secs: f32,
    pub dim_after_secs: f32,
    pub break_after_secs: f32,
    pub max_opacity_soft: f32,
    pub max_opacity_dim: f32,
    pub max_opacity_break: f32,
    pub ema_alpha: f32,
    pub face_grace_secs: f32,
    pub emotion_hold_secs: f32,
}

impl FeedbackProfile {
    pub fn from_name(name: &str) -> Self {
        match name {
            "strong" => Self {
                ramp_per_sec: 0.12,
                nudge_after_secs: 2.0,
                dim_after_secs: 5.0,
                break_after_secs: 30.0,
                max_opacity_soft: 0.35,
                max_opacity_dim: 1.0,
                max_opacity_break: 1.0,
                ema_alpha: 0.22,
                face_grace_secs: 1.5,
                emotion_hold_secs: 2.0,
            },
            "standard" => Self {
                ramp_per_sec: 0.08,
                nudge_after_secs: 3.0,
                dim_after_secs: 8.0,
                break_after_secs: 45.0,
                max_opacity_soft: 0.28,
                max_opacity_dim: 1.0,
                max_opacity_break: 1.0,
                ema_alpha: 0.15,
                face_grace_secs: 2.5,
                emotion_hold_secs: 2.5,
            },
            _ => Self {
                ramp_per_sec: 0.06,
                nudge_after_secs: 4.0,
                dim_after_secs: 10.0,
                break_after_secs: 50.0,
                max_opacity_soft: 0.22,
                max_opacity_dim: 1.0,
                max_opacity_break: 1.0,
                ema_alpha: 0.12,
                face_grace_secs: 3.0,
                emotion_hold_secs: 3.0,
            },
        }
    }
}

pub struct FeedbackEngine {
    profile: FeedbackProfile,
    sensitivity: f32,
    smoothed_score: f32,
    state: FeedbackState,
    prev_state: FeedbackState,
    current_opacity: f32,
    stable_emotion: EmotionLabel,
    emotion_confidence: f32,
    emotion_candidate: EmotionLabel,
    emotion_candidate_since: f64,
    low_attention_since: Option<f64>,
    gaze_away_since: Option<f64>,
    gaze_recovered_since: Option<f64>,
    focused_since: Option<f64>,
    last_reengage_at: f64,
    face_missing_since: Option<f64>,
    face_present_since: Option<f64>,
    had_face_absent_past_grace: bool,
    last_tick_ts: f64,
    break_after_secs: f32,
}

impl FeedbackEngine {
    pub fn new(sensitivity: f32, profile: FeedbackProfile) -> Self {
        Self {
            profile,
            sensitivity,
            smoothed_score: 100.0,
            state: FeedbackState::Focused,
            prev_state: FeedbackState::Focused,
            current_opacity: 0.0,
            stable_emotion: EmotionLabel::Unknown,
            emotion_confidence: 0.0,
            emotion_candidate: EmotionLabel::Unknown,
            emotion_candidate_since: 0.0,
            low_attention_since: None,
            gaze_away_since: None,
            gaze_recovered_since: None,
            focused_since: Some(0.0),
            last_reengage_at: -REENGAGE_COOLDOWN_SECS,
            face_missing_since: None,
            face_present_since: Some(0.0),
            had_face_absent_past_grace: false,
            last_tick_ts: 0.0,
            break_after_secs: profile.break_after_secs,
        }
    }

    pub fn set_sensitivity(&mut self, sensitivity: f32) {
        self.sensitivity = sensitivity;
    }

    pub fn set_profile(&mut self, profile: FeedbackProfile) {
        self.break_after_secs = profile.break_after_secs;
        self.profile = profile;
    }

    pub fn tick(
        &mut self,
        sample: &AttentionSample,
        distraction: &DistractionState,
        now: f64,
    ) -> FeedbackUpdate {
        let dt = if self.last_tick_ts > 0.0 {
            (now - self.last_tick_ts).clamp(0.0, 0.5) as f32
        } else {
            0.1
        };
        self.last_tick_ts = now;

        self.update_smoothed_score(sample, now);
        self.update_emotion(sample, now);
        self.update_face_timer(sample, now);
        self.update_gaze_timer(sample, distraction, now);

        let effective_score = self.effective_score(sample, distraction, now);
        let enter_threshold = self.sensitivity - 5.0;
        let exit_threshold = self.sensitivity + 5.0;

        let is_low = effective_score < enter_threshold;
        let is_recovered = effective_score >= exit_threshold;

        if is_low {
            if self.low_attention_since.is_none() {
                self.low_attention_since = Some(now);
            }
        } else if is_recovered {
            self.low_attention_since = None;
        }

        let low_duration = self
            .low_attention_since
            .map(|t| now - t)
            .unwrap_or(0.0) as f32;

        let gaze_duration = self
            .gaze_away_since
            .map(|t| now - t)
            .unwrap_or(0.0) as f32;

        self.break_after_secs = match self.stable_emotion {
            EmotionLabel::Frustrated => self.profile.break_after_secs * 0.55,
            _ => self.profile.break_after_secs,
        };

        let next_state = self.compute_next_state(
            sample,
            low_duration,
            gaze_duration,
            is_recovered,
            distraction,
            now,
        );

        let recovered_from_feedback = next_state == FeedbackState::Focused
            && matches!(
                self.state,
                FeedbackState::SoftNudge
                    | FeedbackState::Dimmed
                    | FeedbackState::BreakSuggest
                    | FeedbackState::ConfusionHelp
                    | FeedbackState::HyperfocusRedirect
            );

        // Green "back to Here" pulse on any refocus — audio cues stay off (see feedback_cues).
        let show_reengage = recovered_from_feedback
            && sample.face_present
            && self.face_return_ready(now)
            && now - self.last_reengage_at >= REENGAGE_COOLDOWN_SECS;

        self.prev_state = self.state;
        self.state = next_state;

        if self.state == FeedbackState::Focused {
            if self.focused_since.is_none() || recovered_from_feedback {
                self.focused_since = Some(now);
            }
            self.had_face_absent_past_grace = false;
        } else {
            self.focused_since = None;
        }

        if show_reengage {
            self.last_reengage_at = now;
        }

        let target_opacity = self.target_opacity_for_state(distraction);
        self.ramp_opacity_toward(target_opacity, dt);

        let face_absent_past_grace = self.face_missing_past_grace(now);
        let child_message = child_message_for(
            self.state,
            self.stable_emotion,
            face_absent_past_grace,
            distraction.primary,
        );
        let show_break_prompt = self.state == FeedbackState::BreakSuggest;
        let show_confusion_help = self.state == FeedbackState::ConfusionHelp;

        FeedbackUpdate {
            state: self.state,
            opacity: self.current_opacity,
            smoothed_score: self.smoothed_score,
            effective_score,
            emotion: self.stable_emotion.as_str().to_string(),
            child_message,
            show_reengage,
            show_break_prompt,
            show_confusion_help,
            primary_distraction: distraction.primary.map(|k| k.as_str().to_string()),
            face_missing_secs: if sample.face_present {
                0.0
            } else {
                self.face_missing_duration(now)
            },
        }
    }

    fn update_smoothed_score(&mut self, sample: &AttentionSample, now: f64) {
        let alpha = self.profile.ema_alpha;
        let ml_score = sample.engagement_prob * 100.0;
        let raw = if sample.face_present {
            self.face_missing_since = None;
            if sample.engagement_prob > 0.0 {
                ml_score * 0.6 + sample.score * 0.4
            } else {
                sample.score
            }
        } else if let Some(missing_since) = self.face_missing_since {
            let elapsed = now - missing_since;
            if elapsed < self.profile.face_grace_secs as f64 {
                return;
            }
            sample.score.min(self.smoothed_score)
        } else {
            self.face_missing_since = Some(now);
            return;
        };

        if self.smoothed_score <= 0.0 {
            self.smoothed_score = raw;
        } else {
            self.smoothed_score = alpha * raw + (1.0 - alpha) * self.smoothed_score;
        }
    }

    fn update_emotion(&mut self, sample: &AttentionSample, now: f64) {
        let incoming = EmotionLabel::from_str(&sample.emotion);
        let confidence = sample.emotion_confidence.max(
            sample
                .prob_engaged
                .max(sample.prob_bored)
                .max(sample.prob_confused)
                .max(sample.prob_frustrated),
        );
        if incoming == EmotionLabel::Unknown || confidence < 0.45 {
            return;
        }

        if incoming == self.emotion_candidate {
            if now - self.emotion_candidate_since >= self.profile.emotion_hold_secs as f64 {
                self.stable_emotion = incoming;
                self.emotion_confidence = confidence;
            }
        } else {
            self.emotion_candidate = incoming;
            self.emotion_candidate_since = now;
        }
    }

    fn update_face_timer(&mut self, sample: &AttentionSample, now: f64) {
        if sample.face_present {
            if self.face_present_since.is_none() {
                if self.had_face_absent_past_grace {
                    self.gaze_away_since = None;
                    self.gaze_recovered_since = None;
                    self.low_attention_since = None;
                }
                self.face_present_since = Some(now);
            }
        } else {
            self.face_present_since = None;
            if self.face_missing_past_grace(now) {
                self.had_face_absent_past_grace = true;
            }
        }
    }

    fn face_missing_duration(&self, now: f64) -> f32 {
        self.face_missing_since
            .map(|t| now - t)
            .unwrap_or(0.0) as f32
    }

    fn face_missing_past_grace(&self, now: f64) -> bool {
        !self.face_missing_since.is_none()
            && self.face_missing_duration(now) >= self.profile.face_grace_secs
    }

    fn face_return_ready(&self, now: f64) -> bool {
        if !self.had_face_absent_past_grace {
            return true;
        }
        self.face_present_since
            .map(|t| now - t >= FACE_RECOVERY_HOLD_SECS - 1e-6)
            .unwrap_or(false)
    }

    fn allows_focused(&self, sample: &AttentionSample, now: f64) -> bool {
        sample.face_present && self.face_return_ready(now)
    }

    fn face_absent_state(&self, missing_secs: f32) -> FeedbackState {
        if missing_secs >= self.profile.break_after_secs * 0.4 {
            return FeedbackState::BreakSuggest;
        }
        if missing_secs >= self.profile.dim_after_secs * 0.5 {
            return FeedbackState::Dimmed;
        }
        if missing_secs >= self.profile.nudge_after_secs {
            return FeedbackState::SoftNudge;
        }
        if missing_secs >= self.profile.face_grace_secs {
            return match self.state {
                FeedbackState::Focused => FeedbackState::SoftNudge,
                other => other,
            };
        }
        self.state
    }

    fn focused_or_hold(&self, sample: &AttentionSample, now: f64) -> FeedbackState {
        if self.allows_focused(sample, now) {
            FeedbackState::Focused
        } else {
            self.state
        }
    }

    fn update_gaze_timer(
        &mut self,
        sample: &AttentionSample,
        distraction: &DistractionState,
        now: f64,
    ) {
        if !sample.face_present {
            self.gaze_recovered_since = None;
            if self.face_missing_past_grace(now) && self.gaze_away_since.is_none() {
                self.gaze_away_since = Some(now);
            }
            return;
        }

        let drift = distraction.active.contains(&DistractionKind::AttentionDrift);
        let clearly_away = sample.gaze_away_prob >= GAZE_AWAY_ENTER
            || sample.yaw > 0.18
            || sample.pitch > 0.18
            || drift;
        let clearly_engaged = sample.face_present
            && sample.gaze_away_prob <= GAZE_AWAY_EXIT
            && sample.yaw <= 0.12
            && sample.pitch <= 0.12
            && !drift;

        if clearly_away {
            self.gaze_recovered_since = None;
            if self.gaze_away_since.is_none() {
                self.gaze_away_since = Some(now);
            }
        } else if clearly_engaged {
            if self.gaze_recovered_since.is_none() {
                self.gaze_recovered_since = Some(now);
            }
            if self.gaze_away_since.is_some() {
                let recovered_for = now - self.gaze_recovered_since.unwrap_or(now);
                if recovered_for >= GAZE_RECOVERY_HOLD_SECS {
                    self.gaze_away_since = None;
                    self.low_attention_since = None;
                }
            }
        } else {
            // Dead band — hold current timers to avoid flicker at the threshold.
            self.gaze_recovered_since = None;
        }
    }

    fn effective_score(
        &self,
        sample: &AttentionSample,
        distraction: &DistractionState,
        now: f64,
    ) -> f32 {
        let mut score = self.smoothed_score;
        match self.stable_emotion {
            EmotionLabel::Engaged => score += 8.0,
            EmotionLabel::Confused => score -= 5.0,
            EmotionLabel::Frustrated => score += 5.0,
            _ => {}
        }
        if sample.gaze_away_prob >= GAZE_AWAY_ENTER {
            score -= sample.gaze_away_prob * 30.0;
        }
        if distraction.active.contains(&DistractionKind::AttentionDrift) {
            score -= 20.0;
        }
        if sample.engagement_prob < 0.5 {
            score -= (0.5 - sample.engagement_prob) * 20.0;
        }
        if self.face_missing_past_grace(now)
            || (!sample.face_present
                && distraction
                    .active
                    .contains(&DistractionKind::PhysicalDisruption))
        {
            score = score.min(self.sensitivity - 15.0);
        }
        score.min(100.0).max(0.0)
    }

    fn compute_next_state(
        &self,
        sample: &AttentionSample,
        low_duration: f32,
        gaze_duration: f32,
        is_recovered: bool,
        distraction: &DistractionState,
        now: f64,
    ) -> FeedbackState {
        if !sample.face_present {
            let missing = self.face_missing_duration(now);
            if missing < self.profile.face_grace_secs {
                return self.state;
            }
            return self.face_absent_state(missing);
        }

        if distraction
            .active
            .contains(&DistractionKind::EmotionalOverload)
            || (self.stable_emotion == EmotionLabel::Confused
                && low_duration >= 2.5
                && !distraction.active.contains(&DistractionKind::AttentionDrift))
        {
            return FeedbackState::ConfusionHelp;
        }

        if distraction.active.contains(&DistractionKind::FalseHyperfocus) {
            return FeedbackState::HyperfocusRedirect;
        }

        let gaze_drift = distraction.active.contains(&DistractionKind::AttentionDrift);

        // Brief re-entry grace after refocus — ignore flicker at the threshold.
        if self.state == FeedbackState::Focused && self.allows_focused(sample, now) {
            if let Some(since) = self.focused_since {
                if now - since < REENTRY_GRACE_SECS && gaze_duration < self.profile.nudge_after_secs {
                    return FeedbackState::Focused;
                }
            }
        }

        // Hold dim/break until gaze recovery hold completes (gaze_away_since cleared).
        if matches!(
            self.state,
            FeedbackState::SoftNudge
                | FeedbackState::Dimmed
                | FeedbackState::BreakSuggest
                | FeedbackState::ConfusionHelp
        ) && self.gaze_away_since.is_none()
            && !gaze_drift
            && distraction.active.is_empty()
        {
            return self.focused_or_hold(sample, now);
        }

        if gaze_drift || gaze_duration > 0.0 {
            let gaze_nudge_after = 2.0_f32;
            let gaze_dim_after = self.profile.dim_after_secs * 0.5;
            let gaze_break_after = self.break_after_secs * 0.5;

            let mut next = FeedbackState::Focused;
            if gaze_duration >= gaze_break_after {
                next = FeedbackState::BreakSuggest;
            } else if gaze_drift && gaze_duration >= gaze_dim_after {
                next = FeedbackState::Dimmed;
            } else if gaze_duration >= gaze_dim_after {
                next = FeedbackState::Dimmed;
            } else if gaze_drift || gaze_duration >= gaze_nudge_after {
                next = FeedbackState::SoftNudge;
            }

            // Don't downgrade below current state on brief flicker during recovery hold.
            if matches!(
                self.state,
                FeedbackState::Dimmed | FeedbackState::BreakSuggest
            ) && matches!(next, FeedbackState::Focused | FeedbackState::SoftNudge)
            {
                return self.state;
            }
            if self.state == FeedbackState::BreakSuggest
                && matches!(next, FeedbackState::Dimmed | FeedbackState::SoftNudge | FeedbackState::Focused)
            {
                return FeedbackState::BreakSuggest;
            }
            if self.state == FeedbackState::Dimmed
                && matches!(next, FeedbackState::SoftNudge | FeedbackState::Focused)
            {
                return FeedbackState::Dimmed;
            }

            if next != FeedbackState::Focused {
                return next;
            }
        }

        if distraction.active.contains(&DistractionKind::TaskSwitching) {
            if low_duration >= self.profile.nudge_after_secs {
                return FeedbackState::SoftNudge;
            }
            return self.focused_or_hold(sample, now);
        }

        if distraction.active.contains(&DistractionKind::OffTaskApp) {
            if self.stable_emotion == EmotionLabel::Confused {
                return FeedbackState::ConfusionHelp;
            }
            if low_duration >= self.profile.nudge_after_secs {
                return FeedbackState::SoftNudge;
            }
        }

        if is_recovered
            && low_duration < self.profile.nudge_after_secs * 0.5
            && self.allows_focused(sample, now)
        {
            return FeedbackState::Focused;
        }

        if low_duration >= self.break_after_secs {
            return FeedbackState::BreakSuggest;
        }

        if self.stable_emotion == EmotionLabel::Confused {
            if low_duration >= self.profile.nudge_after_secs {
                return FeedbackState::ConfusionHelp;
            }
            return self.focused_or_hold(sample, now);
        }

        if low_duration >= self.profile.dim_after_secs {
            if distraction.active.contains(&DistractionKind::OffTaskApp) {
                return FeedbackState::SoftNudge;
            }
            return FeedbackState::Dimmed;
        }

        if low_duration >= self.profile.nudge_after_secs {
            return FeedbackState::SoftNudge;
        }

        self.focused_or_hold(sample, now)
    }

    fn target_opacity_for_state(&self, distraction: &DistractionState) -> f32 {
        match self.state {
            FeedbackState::Focused => 0.0,
            FeedbackState::SoftNudge => {
                let base = if distraction.active.contains(&DistractionKind::AttentionDrift) {
                    self.profile.max_opacity_soft * 1.15
                } else if distraction.active.contains(&DistractionKind::TaskSwitching) {
                    self.profile.max_opacity_soft * 0.75
                } else {
                    self.profile.max_opacity_soft
                };
                base.min(1.0)
            }
            FeedbackState::Dimmed => self.profile.max_opacity_dim,
            FeedbackState::BreakSuggest => self.profile.max_opacity_break,
            FeedbackState::ConfusionHelp => self.profile.max_opacity_soft * 0.65,
            FeedbackState::HyperfocusRedirect => self.profile.max_opacity_soft * 0.5,
        }
    }

    fn ramp_opacity_toward(&mut self, target: f32, dt: f32) {
        let ramp_rate = if target < self.current_opacity {
            self.profile.ramp_per_sec * 3.5
        } else if target >= 0.85 {
            self.profile.ramp_per_sec * 2.5
        } else {
            self.profile.ramp_per_sec
        };
        let max_delta = ramp_rate * dt;
        let diff = target - self.current_opacity;
        if diff.abs() <= max_delta {
            self.current_opacity = target;
        } else if diff > 0.0 {
            self.current_opacity += max_delta;
        } else {
            self.current_opacity -= max_delta;
        }
        self.current_opacity = self.current_opacity.clamp(0.0, 1.0);
    }

    pub fn state(&self) -> FeedbackState {
        self.state
    }
}

fn child_message_for(
    state: FeedbackState,
    emotion: EmotionLabel,
    face_absent_past_grace: bool,
    primary: Option<DistractionKind>,
) -> String {
    let face_absent = face_absent_past_grace
        || primary == Some(DistractionKind::PhysicalDisruption);

    match state {
        FeedbackState::Focused => match emotion {
            EmotionLabel::Engaged => "Here with you".to_string(),
            _ => "Here".to_string(),
        },
        FeedbackState::SoftNudge if face_absent => "Come back — I can't see you".to_string(),
        FeedbackState::SoftNudge => "Let's refocus together".to_string(),
        FeedbackState::Dimmed if face_absent => "Still here when you're ready".to_string(),
        FeedbackState::Dimmed => "Taking a small pause".to_string(),
        FeedbackState::BreakSuggest => "Want a quick stretch break?".to_string(),
        FeedbackState::ConfusionHelp => "Stuck? It's okay — look back at the lesson".to_string(),
        FeedbackState::HyperfocusRedirect => {
            "You're locked in — want to switch back to your task?".to_string()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::distraction::{DistractionKind, DistractionState};

    fn sample(score: f32, face: bool, emotion: &str) -> AttentionSample {
        AttentionSample {
            score,
            face_present: face,
            timestamp: 0.0,
            face_quality: score,
            eye_openness: score,
            head_pose_penalty: 100.0,
            emotion: emotion.to_string(),
            emotion_confidence: 0.8,
            engagement_prob: score / 100.0,
            gaze_away_prob: 0.1,
            prob_engaged: 0.2,
            prob_bored: 0.2,
            prob_confused: if emotion == "confused" { 0.8 } else { 0.1 },
            prob_frustrated: 0.1,
            prob_neutral: 0.2,
            yaw: 0.0,
            pitch: 0.0,
            model_version: "test".to_string(),
        }
    }

    fn empty_distraction() -> DistractionState {
        DistractionState::default()
    }

    fn gaze_drift_distraction() -> DistractionState {
        DistractionState {
            primary: Some(DistractionKind::AttentionDrift),
            active: vec![DistractionKind::AttentionDrift],
            events: vec![],
            task_switch_count_60s: 0,
            current_app_bundle: None,
            current_app_dwell_secs: 0.0,
        }
    }

    fn gaze_away_sample(gaze: f32) -> AttentionSample {
        let mut s = sample(75.0, true, "neutral");
        s.gaze_away_prob = gaze;
        s.yaw = 0.25;
        s.engagement_prob = 0.55;
        s
    }

    fn gaze_engaged_sample() -> AttentionSample {
        let mut s = sample(95.0, true, "engaged");
        s.gaze_away_prob = 0.05;
        s.yaw = 0.0;
        s.pitch = 0.0;
        s.engagement_prob = 0.92;
        s
    }

    /// Matches Swift emit when no face is detected (zeros for gaze/pose).
    fn face_absent_sample() -> AttentionSample {
        AttentionSample {
            score: 0.0,
            face_present: false,
            timestamp: 0.0,
            face_quality: 0.0,
            eye_openness: 0.0,
            head_pose_penalty: 0.0,
            emotion: "unknown".to_string(),
            emotion_confidence: 0.0,
            engagement_prob: 0.0,
            gaze_away_prob: 0.0,
            prob_engaged: 0.0,
            prob_bored: 0.0,
            prob_confused: 0.0,
            prob_frustrated: 0.0,
            prob_neutral: 1.0,
            yaw: 0.0,
            pitch: 0.0,
            model_version: "test".to_string(),
        }
    }

    fn physical_disruption_distraction() -> DistractionState {
        DistractionState {
            primary: Some(DistractionKind::PhysicalDisruption),
            active: vec![DistractionKind::PhysicalDisruption],
            events: vec![],
            task_switch_count_60s: 0,
            current_app_bundle: None,
            current_app_dwell_secs: 0.0,
        }
    }

    #[test]
    fn attention_drift_triggers_soft_nudge() {
        let mut engine = FeedbackEngine::new(70.0, FeedbackProfile::from_name("gentle"));
        let mut now = 0.0;
        let distraction = gaze_drift_distraction();
        let s = gaze_away_sample(0.6);
        let mut got_nudge = false;
        for _ in 0..40 {
            let update = engine.tick(&s, &distraction, now);
            now += 0.1;
            if update.state == FeedbackState::SoftNudge {
                got_nudge = true;
                break;
            }
        }
        assert!(got_nudge, "expected SoftNudge when AttentionDrift active");
    }

    #[test]
    fn sustained_gaze_drift_reaches_dimmed() {
        let mut engine = FeedbackEngine::new(70.0, FeedbackProfile::from_name("gentle"));
        let mut now = 0.0;
        let distraction = gaze_drift_distraction();
        let s = gaze_away_sample(0.65);
        let mut max_opacity = 0.0_f32;
        for _ in 0..120 {
            let update = engine.tick(&s, &distraction, now);
            max_opacity = max_opacity.max(update.opacity);
            now += 0.1;
            if update.state == FeedbackState::Dimmed && update.opacity > 0.3 {
                return;
            }
        }
        panic!(
            "expected Dimmed with opacity > 0.3, max_opacity={max_opacity}, state={:?}",
            engine.state
        );
    }

    #[test]
    fn sustained_distraction_reaches_full_opacity() {
        let mut engine = FeedbackEngine::new(70.0, FeedbackProfile::from_name("strong"));
        let mut now = 0.0;
        let drift = gaze_drift_distraction();
        let away = gaze_away_sample(0.75);
        for _ in 0..200 {
            let update = engine.tick(&away, &drift, now);
            now += 0.1;
            if update.state == FeedbackState::Dimmed && update.opacity >= 0.95 {
                return;
            }
        }
        panic!(
            "expected full opacity when dimmed, opacity={}",
            engine.current_opacity
        );
    }

    #[test]
    fn gaze_recovery_shows_reengage() {
        let mut engine = FeedbackEngine::new(70.0, FeedbackProfile::from_name("gentle"));
        let mut now = 0.0;
        let drift = gaze_drift_distraction();
        let away = gaze_away_sample(0.7);
        for _ in 0..80 {
            engine.tick(&away, &drift, now);
            now += 0.1;
        }
        let focused = gaze_engaged_sample();
        let mut saw_reengage = false;
        for _ in 0..40 {
            let update = engine.tick(&focused, &empty_distraction(), now);
            now += 0.1;
            if update.show_reengage {
                saw_reengage = true;
                assert_eq!(update.state, FeedbackState::Focused);
                break;
            }
        }
        assert!(saw_reengage, "expected reengage pulse after sustained gaze recovery");
    }

    #[test]
    fn confused_emotion_does_not_block_gaze_drift_dim() {
        let mut engine = FeedbackEngine::new(70.0, FeedbackProfile::from_name("gentle"));
        let mut now = 0.0;
        let distraction = gaze_drift_distraction();
        let mut s = gaze_away_sample(0.65);
        s.emotion = "confused".to_string();
        s.prob_confused = 0.8;
        for _ in 0..30 {
            engine.tick(&s, &distraction, now);
            now += 0.1;
        }
        for _ in 0..100 {
            let update = engine.tick(&s, &distraction, now);
            now += 0.1;
            if matches!(update.state, FeedbackState::SoftNudge | FeedbackState::Dimmed) {
                return;
            }
        }
        panic!("confused + gaze drift should still nudge/dim, got {:?}", engine.state);
    }

    #[test]
    fn break_suggest_clears_when_gaze_returns() {
        let mut engine = FeedbackEngine::new(70.0, FeedbackProfile::from_name("strong"));
        let mut now = 0.0;
        let drift = gaze_drift_distraction();
        let away = gaze_away_sample(0.75);
        for _ in 0..200 {
            engine.tick(&away, &drift, now);
            now += 0.1;
        }
        assert!(
            matches!(
                engine.state(),
                FeedbackState::BreakSuggest | FeedbackState::Dimmed
            ),
            "expected break or dim after sustained gaze, got {:?}",
            engine.state()
        );

        let focused = gaze_engaged_sample();
        let mut cleared = false;
        for _ in 0..60 {
            let update = engine.tick(&focused, &empty_distraction(), now);
            now += 0.1;
            if update.state == FeedbackState::Focused && update.opacity < 0.2 {
                cleared = true;
                break;
            }
        }
        assert!(cleared, "break/dim should clear after sustained gaze recovery");
    }

    #[test]
    fn opacity_fades_faster_than_it_rises() {
        let mut engine = FeedbackEngine::new(70.0, FeedbackProfile::from_name("strong"));
        let mut now = 0.0;
        let drift = gaze_drift_distraction();
        let away = gaze_away_sample(0.7);
        let mut ticks_to_dim = 0;
        for _ in 0..120 {
            let update = engine.tick(&away, &drift, now);
            now += 0.1;
            ticks_to_dim += 1;
            if update.opacity > 0.25 {
                break;
            }
        }
        let peak = engine.current_opacity;
        assert!(peak > 0.2, "expected visible dim, peak={peak}");

        let focused = gaze_engaged_sample();
        let mut ticks_to_clear = 0;
        for _ in 0..60 {
            let update = engine.tick(&focused, &empty_distraction(), now);
            now += 0.1;
            ticks_to_clear += 1;
            if update.state == FeedbackState::Focused && update.opacity < peak * 0.35 {
                return;
            }
        }
        panic!(
            "fade-out should be faster than ramp-up, peak={peak}, opacity={}, rise_ticks={ticks_to_dim}, fade_ticks={ticks_to_clear}",
            engine.current_opacity
        );
    }

    #[test]
    fn gaze_flicker_does_not_oscillate_focused_and_dim() {
        let mut engine = FeedbackEngine::new(70.0, FeedbackProfile::from_name("strong"));
        let mut now = 0.0;
        let drift = gaze_drift_distraction();
        let away = gaze_away_sample(0.7);
        let engaged = gaze_engaged_sample();
        for _ in 0..100 {
            engine.tick(&away, &drift, now);
            now += 0.1;
        }
        assert!(matches!(
            engine.state(),
            FeedbackState::Dimmed | FeedbackState::BreakSuggest | FeedbackState::SoftNudge
        ));

        let mut transitions = 0;
        let mut last = engine.state();
        for i in 0..50 {
            let (sample, distraction) = if i % 2 == 0 {
                (&away, &drift)
            } else {
                (&engaged, &empty_distraction())
            };
            let update = engine.tick(sample, distraction, now);
            now += 0.1;
            if update.state != last {
                transitions += 1;
                last = update.state;
            }
        }
        assert!(
            transitions <= 4,
            "gaze flicker caused {transitions} state flips, final={:?}",
            engine.state()
        );
    }

    #[test]
    fn ramps_slowly_toward_dim() {
        let mut engine = FeedbackEngine::new(70.0, FeedbackProfile::from_name("strong"));
        let mut now = 0.0;
        let drift = gaze_drift_distraction();
        let away = gaze_away_sample(0.65);
        for _ in 0..80 {
            let update = engine.tick(&away, &drift, now);
            now += 0.1;
            if update.opacity > 0.15 {
                assert!(update.opacity < 0.45, "early ramp should stay gradual");
                return;
            }
        }
        panic!(
            "expected gradual ramp toward dim, opacity={}",
            engine.current_opacity
        );
    }

    #[test]
    fn confusion_avoids_full_dim() {
        let mut engine = FeedbackEngine::new(70.0, FeedbackProfile::from_name("gentle"));
        let mut now = 0.0;
        let mut max_opacity = 0.0_f32;
        for _ in 0..300 {
            let update = engine.tick(&sample(25.0, true, "confused"), &empty_distraction(), now);
            max_opacity = max_opacity.max(update.opacity);
            now += 0.1;
        }
        assert_eq!(engine.state, FeedbackState::ConfusionHelp);
        assert!(max_opacity < 0.25);
    }

    #[test]
    fn emotional_overload_triggers_help() {
        let mut engine = FeedbackEngine::new(70.0, FeedbackProfile::from_name("gentle"));
        let mut now = 0.0;
        let distraction = DistractionState {
            primary: Some(DistractionKind::EmotionalOverload),
            active: vec![DistractionKind::EmotionalOverload],
            events: vec![],
            task_switch_count_60s: 0,
            current_app_bundle: None,
            current_app_dwell_secs: 0.0,
        };
        let mut s = sample(50.0, true, "frustrated");
        s.prob_frustrated = 0.85;
        s.emotion_confidence = 0.85;
        for _ in 0..30 {
            let update = engine.tick(&s, &distraction, now);
            now += 0.1;
            if update.state == FeedbackState::ConfusionHelp {
                return;
            }
        }
        assert_eq!(engine.state, FeedbackState::ConfusionHelp);
    }

    #[test]
    fn face_absent_never_focused_after_grace() {
        let mut engine = FeedbackEngine::new(70.0, FeedbackProfile::from_name("strong"));
        let mut now = 0.0;
        let absent = face_absent_sample();
        let disruption = physical_disruption_distraction();
        for _ in 0..50 {
            let update = engine.tick(&absent, &disruption, now);
            now += 0.1;
            if now > 2.0 {
                assert_ne!(
                    update.state,
                    FeedbackState::Focused,
                    "face absent should not return Focused after grace at t={now}"
                );
            }
        }
    }

    #[test]
    fn face_absent_escalates() {
        let mut engine = FeedbackEngine::new(70.0, FeedbackProfile::from_name("strong"));
        let mut now = 0.0;
        let absent = face_absent_sample();
        let disruption = physical_disruption_distraction();

        let mut saw_nudge = false;
        for _ in 0..30 {
            let update = engine.tick(&absent, &disruption, now);
            now += 0.1;
            if matches!(
                update.state,
                FeedbackState::SoftNudge | FeedbackState::Dimmed | FeedbackState::BreakSuggest
            ) {
                saw_nudge = true;
                break;
            }
        }
        assert!(saw_nudge, "face absent should escalate past grace");

        for _ in 0..120 {
            engine.tick(&absent, &disruption, now);
            now += 0.1;
        }
        assert!(
            matches!(
                engine.state(),
                FeedbackState::Dimmed | FeedbackState::BreakSuggest
            ),
            "sustained absence should reach dim/break, got {:?}",
            engine.state()
        );
    }

    #[test]
    fn face_grace_tolerated() {
        let mut engine = FeedbackEngine::new(70.0, FeedbackProfile::from_name("strong"));
        let mut now = 0.0;
        let absent = face_absent_sample();
        for _ in 0..10 {
            let update = engine.tick(&absent, &empty_distraction(), now);
            now += 0.1;
            assert_eq!(
                update.state,
                FeedbackState::Focused,
                "brief face loss within grace should stay Focused"
            );
        }
    }

    #[test]
    fn face_return_requires_hold() {
        let mut engine = FeedbackEngine::new(70.0, FeedbackProfile::from_name("strong"));
        let mut now = 0.0;
        let absent = face_absent_sample();
        let disruption = physical_disruption_distraction();
        for _ in 0..80 {
            engine.tick(&absent, &disruption, now);
            now += 0.1;
        }
        assert!(
            matches!(
                engine.state(),
                FeedbackState::Dimmed | FeedbackState::BreakSuggest | FeedbackState::SoftNudge
            ),
            "expected escalated state before return, got {:?}",
            engine.state()
        );

        let engaged = gaze_engaged_sample();
        for i in 0..20 {
            let update = engine.tick(&engaged, &empty_distraction(), now);
            now += 0.1;
            assert_ne!(
                update.state,
                FeedbackState::Focused,
                "Focused too soon after face return (tick {i})"
            );
        }
        let update = engine.tick(&engaged, &empty_distraction(), now);
        assert_eq!(
            update.state,
            FeedbackState::Focused,
            "Focused after 2s sustained face return"
        );
    }

    #[test]
    fn face_absent_does_not_trigger_reengage() {
        let mut engine = FeedbackEngine::new(70.0, FeedbackProfile::from_name("strong"));
        let mut now = 0.0;
        let absent = face_absent_sample();
        let disruption = physical_disruption_distraction();
        for _ in 0..50 {
            let update = engine.tick(&absent, &disruption, now);
            now += 0.1;
            assert!(
                !update.show_reengage,
                "reengage must not fire while face is absent"
            );
        }
    }
}

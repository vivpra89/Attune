use crate::vision::{AttentionSample, EmotionLabel};
use serde::{Deserialize, Serialize};
use std::collections::VecDeque;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DistractionKind {
    AttentionDrift,
    TaskSwitching,
    OffTaskApp,
    PhysicalDisruption,
    EmotionalOverload,
    FalseHyperfocus,
}

impl DistractionKind {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::AttentionDrift => "attention_drift",
            Self::TaskSwitching => "task_switching",
            Self::OffTaskApp => "off_task_app",
            Self::PhysicalDisruption => "physical_disruption",
            Self::EmotionalOverload => "emotional_overload",
            Self::FalseHyperfocus => "false_hyperfocus",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DistractionEvent {
    pub kind: DistractionKind,
    pub severity: f32,
    pub confidence: f32,
    pub ts: f64,
    pub app_bundle_id: Option<String>,
    pub metadata: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize)]
pub struct DistractionState {
    pub primary: Option<DistractionKind>,
    pub active: Vec<DistractionKind>,
    pub events: Vec<DistractionEvent>,
    pub task_switch_count_60s: u32,
    pub current_app_bundle: Option<String>,
    pub current_app_dwell_secs: f32,
}

pub struct DistractionFusionEngine {
    focus_apps: Vec<String>,
    app_switches: VecDeque<(f64, String)>,
    current_app: Option<(String, String, f64)>,
    hold_since: std::collections::HashMap<DistractionKind, f64>,
    hold_threshold_secs: f32,
    switch_window_secs: f64,
    switch_threshold: u32,
}

impl DistractionFusionEngine {
    pub fn new(focus_apps: Vec<String>) -> Self {
        Self {
            focus_apps,
            app_switches: VecDeque::new(),
            current_app: None,
            hold_since: std::collections::HashMap::new(),
            hold_threshold_secs: 1.5,
            switch_window_secs: 60.0,
            switch_threshold: 4,
        }
    }

    pub fn set_focus_apps(&mut self, apps: Vec<String>) {
        self.focus_apps = apps;
    }

    pub fn tick(
        &mut self,
        sample: &AttentionSample,
        app_name: Option<&str>,
        app_bundle: Option<&str>,
        now: f64,
    ) -> DistractionState {
        self.update_app_context(app_name, app_bundle, now);

        let mut candidates: Vec<(DistractionKind, f32, f32, Option<String>, Option<String>)> =
            Vec::new();

        if !sample.face_present {
            candidates.push((
                DistractionKind::PhysicalDisruption,
                0.7,
                0.85,
                app_bundle.map(String::from),
                Some("face_absent".to_string()),
            ));
        } else if sample.gaze_away_prob > 0.40
            || sample.yaw > 0.15
            || sample.pitch > 0.15
        {
            let drift_conf = sample.gaze_away_prob.max(if sample.yaw > 0.15 || sample.pitch > 0.15 {
                0.55
            } else {
                0.0
            });
            candidates.push((
                DistractionKind::AttentionDrift,
                drift_conf,
                drift_conf,
                app_bundle.map(String::from),
                None,
            ));
        } else if sample.engagement_prob < 0.35 {
            candidates.push((
                DistractionKind::AttentionDrift,
                1.0 - sample.engagement_prob,
                0.7,
                app_bundle.map(String::from),
                None,
            ));
        }

        let confused = sample.prob_confused > 0.55;
        let frustrated = sample.prob_frustrated > 0.55;
        if confused || frustrated {
            let conf = sample.prob_confused.max(sample.prob_frustrated);
            candidates.push((
                DistractionKind::EmotionalOverload,
                conf,
                conf,
                app_bundle.map(String::from),
                None,
            ));
        }

        let switch_count = self.task_switch_count(now);
        if switch_count >= self.switch_threshold {
            candidates.push((
                DistractionKind::TaskSwitching,
                (switch_count as f32 / 8.0).min(1.0),
                0.75,
                app_bundle.map(String::from),
                Some(format!("switches={switch_count}")),
            ));
        }

        if let Some(bundle) = app_bundle {
            if !self.focus_apps.is_empty()
                && !self.focus_apps.iter().any(|a| a == bundle)
                && !bundle.contains("attune")
            {
                let on_task_confused = confused && sample.engagement_prob > 0.4;
                if !on_task_confused {
                    candidates.push((
                        DistractionKind::OffTaskApp,
                        0.65,
                        0.8,
                        Some(bundle.to_string()),
                        app_name.map(String::from),
                    ));
                }

                if sample.engagement_prob > 0.7 && sample.prob_engaged > 0.6 {
                    candidates.push((
                        DistractionKind::FalseHyperfocus,
                        sample.engagement_prob,
                        0.72,
                        Some(bundle.to_string()),
                        app_name.map(String::from),
                    ));
                }
            }
        }

        let mut events = Vec::new();
        let mut active = Vec::new();

        for (kind, severity, confidence, bundle, meta) in candidates {
            let entry = self.hold_since.entry(kind).or_insert(now);
            if now - *entry >= self.hold_threshold_secs as f64 && confidence >= 0.55 {
                active.push(kind);
                events.push(DistractionEvent {
                    kind,
                    severity,
                    confidence,
                    ts: now,
                    app_bundle_id: bundle,
                    metadata: meta,
                });
            }
        }

        for kind in [
            DistractionKind::AttentionDrift,
            DistractionKind::TaskSwitching,
            DistractionKind::OffTaskApp,
            DistractionKind::PhysicalDisruption,
            DistractionKind::EmotionalOverload,
            DistractionKind::FalseHyperfocus,
        ] {
            if !active.contains(&kind) {
                self.hold_since.remove(&kind);
            }
        }

        let primary = Self::pick_primary(&active);

        DistractionState {
            primary,
            active,
            events,
            task_switch_count_60s: switch_count,
            current_app_bundle: app_bundle.map(String::from),
            current_app_dwell_secs: self.current_dwell(now),
        }
    }

    fn pick_primary(active: &[DistractionKind]) -> Option<DistractionKind> {
        if active.contains(&DistractionKind::EmotionalOverload) {
            return Some(DistractionKind::EmotionalOverload);
        }
        if active.contains(&DistractionKind::PhysicalDisruption) {
            return Some(DistractionKind::PhysicalDisruption);
        }
        if active.contains(&DistractionKind::FalseHyperfocus) {
            return Some(DistractionKind::FalseHyperfocus);
        }
        if active.contains(&DistractionKind::TaskSwitching) {
            return Some(DistractionKind::TaskSwitching);
        }
        if active.contains(&DistractionKind::OffTaskApp) {
            return Some(DistractionKind::OffTaskApp);
        }
        if active.contains(&DistractionKind::AttentionDrift) {
            return Some(DistractionKind::AttentionDrift);
        }
        None
    }

    fn update_app_context(&mut self, name: Option<&str>, bundle: Option<&str>, now: f64) {
        let Some(bundle) = bundle else { return };
        if bundle.contains("attune") {
            return;
        }
        let name = name.unwrap_or(bundle).to_string();
        let bundle = bundle.to_string();

        if let Some((_, prev_bundle, _)) = &self.current_app {
            if prev_bundle != &bundle {
                self.app_switches.push_back((now, bundle.clone()));
                while self.app_switches.len() > 32 {
                    self.app_switches.pop_front();
                }
            } else {
                return;
            }
        }
        self.current_app = Some((name, bundle, now));
    }

    fn task_switch_count(&self, now: f64) -> u32 {
        self.app_switches
            .iter()
            .filter(|(t, _)| now - *t <= self.switch_window_secs)
            .count() as u32
    }

    fn current_dwell(&self, now: f64) -> f32 {
        self.current_app
            .as_ref()
            .map(|(_, _, start)| (now - start) as f32)
            .unwrap_or(0.0)
    }
}

pub fn emotion_from_probs(sample: &AttentionSample) -> (EmotionLabel, f32) {
    let probs = [
        (EmotionLabel::Engaged, sample.prob_engaged),
        (EmotionLabel::Bored, sample.prob_bored),
        (EmotionLabel::Confused, sample.prob_confused),
        (EmotionLabel::Frustrated, sample.prob_frustrated),
    ];
    let mut best = (EmotionLabel::Unknown, sample.prob_neutral);
    for (label, prob) in probs {
        if prob > best.1 {
            best = (label, prob);
        }
    }
    if best.1 < 0.35 {
        (EmotionLabel::Unknown, best.1)
    } else {
        best
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample(engagement: f32, gaze: f32, bundle: Option<&str>) -> (AttentionSample, Option<String>, Option<String>) {
        (
            AttentionSample {
                score: engagement * 100.0,
                face_present: true,
                timestamp: 0.0,
                face_quality: 80.0,
                eye_openness: 0.6,
                head_pose_penalty: 80.0,
                emotion: "engaged".to_string(),
                emotion_confidence: 0.7,
                engagement_prob: engagement,
                gaze_away_prob: gaze,
                prob_engaged: 0.7,
                prob_bored: 0.1,
                prob_confused: 0.1,
            prob_frustrated: 0.05,
            prob_neutral: 0.05,
            yaw: 0.0,
            pitch: 0.0,
            model_version: "test".to_string(),
            },
            Some("Safari".to_string()),
            bundle.map(String::from),
        )
    }

    #[test]
    fn detects_task_switching_after_threshold() {
        let mut engine = DistractionFusionEngine::new(vec!["com.khanacademy".to_string()]);
        let mut now = 0.0;
        let bundles = ["com.apple.Safari", "com.google.Chrome", "com.slack.Slack", "com.discord.Discord", "com.apple.Music"];
        for b in bundles {
            let (s, _, bundle) = sample(0.5, 0.2, Some(b));
            let state = engine.tick(&s, Some("App"), bundle.as_deref(), now);
            now += 5.0;
            if state.active.contains(&DistractionKind::TaskSwitching) {
                return;
            }
        }
        let (s, _, bundle) = sample(0.5, 0.2, Some("com.apple.TV"));
        let state = engine.tick(&s, Some("TV"), bundle.as_deref(), now);
        assert!(state.task_switch_count_60s >= 4);
    }
}

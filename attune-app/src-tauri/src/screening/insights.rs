use super::naturalistic::NaturalisticFeatureSet;
use super::norms::{band_for_age, load_norms, parse_child_age, AgeBand};
use super::trials::TrialTaskSummary;
use crate::screening::ScreeningFeatureSet;
use crate::vision::get_inference_status;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScreeningEvidence {
    pub metric: String,
    pub observed_value: f32,
    pub reference_p25: Option<f32>,
    pub reference_p50: Option<f32>,
    pub reference_p75: Option<f32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScreeningInsight {
    pub id: String,
    pub construct: String,
    pub severity: String,
    pub headline: String,
    pub what_we_saw: String,
    pub why_it_matters: String,
    pub possible_contributors: Vec<String>,
    pub confidence: String,
    pub evidence: ScreeningEvidence,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScreeningQuality {
    pub overall: String,
    pub face_present_ratio: f32,
    pub mean_face_quality: f32,
    pub gaze_model_ok: bool,
    pub model_version: String,
    pub valid_antisaccade_trials: u32,
    pub minimum_trials_met: bool,
    pub issues: Vec<String>,
    pub retest_guidance: Option<String>,
}

const COMMON_CONFOUNDERS: &[&str] = &[
    "Poor sleep or fatigue",
    "Illness or medication effects",
    "Anxiety or first-time task novelty",
    "Screen distance or lighting",
    "Webcam gaze is less precise than clinical eye tracking",
];

pub fn assess_quality(
    features: &[ScreeningFeatureSet],
    trial_summaries: &[TrialTaskSummary],
    model_version: &str,
    gaze_loaded: bool,
) -> ScreeningQuality {
    let mut issues = Vec::new();

    let face_ratios: Vec<f32> = features.iter().map(|f| f.face_present_ratio).collect();
    let face_present_ratio = if face_ratios.is_empty() {
        0.0
    } else {
        face_ratios.iter().sum::<f32>() / face_ratios.len() as f32
    };

    let qualities: Vec<f32> = features.iter().map(|f| f.mean_face_quality).collect();
    let mean_face_quality = if qualities.is_empty() {
        0.0
    } else {
        qualities.iter().sum::<f32>() / qualities.len() as f32
    };

    let gaze_model_ok = gaze_loaded && !model_version.starts_with("heuristic");
    if face_present_ratio < 0.85 {
        issues.push("Face was not consistently visible to the camera.".to_string());
    }
    if mean_face_quality < 45.0 {
        issues.push("Camera image quality was low during parts of the screening.".to_string());
    }
    if !gaze_model_ok {
        issues.push(
            "Pretrained gaze model not loaded — run bootstrap_inference.sh for best accuracy."
                .to_string(),
        );
    }

    let anti = trial_summaries
        .iter()
        .find(|t| t.task_id == "antisaccade");
    let valid_antisaccade_trials = anti.map(|t| t.scored_count).unwrap_or(0);
    let minimum_trials_met = valid_antisaccade_trials >= 6;
    if !minimum_trials_met {
        issues.push(format!(
            "Only {valid_antisaccade_trials} of 8 antisaccade trials could be scored."
        ));
    }

    let overall = if issues.len() >= 3 || face_present_ratio < 0.7 {
        "low"
    } else if !issues.is_empty() {
        "medium"
    } else {
        "high"
    };

    let retest_guidance = if overall == "low" {
        Some(
            "Repeat the screening in a quiet room with the child arm's length from the screen, \
             face centered, and good lighting. Ensure the gaze model is loaded before retesting."
                .to_string(),
        )
    } else {
        None
    };

    ScreeningQuality {
        overall: overall.to_string(),
        face_present_ratio,
        mean_face_quality,
        gaze_model_ok,
        model_version: model_version.to_string(),
        valid_antisaccade_trials,
        minimum_trials_met,
        issues,
        retest_guidance,
    }
}

fn insight_confidence(quality: &ScreeningQuality) -> String {
    match quality.overall.as_str() {
        "high" => "high",
        "medium" => "medium",
        _ => "low",
    }
    .to_string()
}

pub fn build_insights(
    features: &[ScreeningFeatureSet],
    trial_summaries: &[TrialTaskSummary],
    naturalistic: Option<&NaturalisticFeatureSet>,
    quality: &ScreeningQuality,
    age_band: &AgeBand,
) -> Vec<ScreeningInsight> {
    let mut insights = Vec::new();
    let confidence = insight_confidence(quality);

    if quality.overall == "low" {
        insights.push(ScreeningInsight {
            id: "data_quality_low".to_string(),
            construct: "data_validity".to_string(),
            severity: "info".to_string(),
            headline: "Screening data quality was limited".to_string(),
            what_we_saw: quality.issues.join(" "),
            why_it_matters: "Attention patterns can only be interpreted when the camera reliably \
                tracks the child's face and enough trials are scored."
                .to_string(),
            possible_contributors: quality
                .issues
                .iter()
                .map(|s| s.clone())
                .collect(),
            confidence: "high".to_string(),
            evidence: ScreeningEvidence {
                metric: "face_present_ratio".to_string(),
                observed_value: quality.face_present_ratio,
                reference_p25: Some(0.85),
                reference_p50: Some(0.92),
                reference_p75: Some(0.98),
            },
        });
        return insights;
    }

    if let Some(anti) = trial_summaries.iter().find(|t| t.task_id == "antisaccade") {
        if anti.scored_count >= 4 {
            let rate = anti.error_rate;
            let norms = &age_band.antisaccade_error_rate;
            if rate > norms.p75 {
                insights.push(ScreeningInsight {
                    id: "antisaccade_elevated_errors".to_string(),
                    construct: "response_inhibition".to_string(),
                    severity: "moderate".to_string(),
                    headline: "More looks toward the cue during antisaccade trials".to_string(),
                    what_we_saw: format!(
                        "{} of {} antisaccade trials moved toward the cue instead of the opposite side (error rate {:.0}%).",
                        anti.error_count,
                        anti.scored_count,
                        rate * 100.0
                    ),
                    why_it_matters: "The antisaccade task measures response inhibition — the ability \
                        to suppress an automatic look toward a sudden cue. Research links higher \
                        direction error rates to executive attention difficulties, including patterns \
                        studied in ADHD."
                        .to_string(),
                    possible_contributors: COMMON_CONFOUNDERS.iter().map(|s| s.to_string()).collect(),
                    confidence: confidence.clone(),
                    evidence: ScreeningEvidence {
                        metric: "antisaccade_error_rate".to_string(),
                        observed_value: rate,
                        reference_p25: Some(norms.p25),
                        reference_p50: Some(norms.p50),
                        reference_p75: Some(norms.p75),
                    },
                });
            } else if rate <= norms.p25 && anti.scored_count >= 6 {
                insights.push(ScreeningInsight {
                    id: "antisaccade_typical_inhibition".to_string(),
                    construct: "response_inhibition".to_string(),
                    severity: "info".to_string(),
                    headline: "Antisaccade inhibition within typical research range".to_string(),
                    what_we_saw: format!(
                        "{} of {} antisaccade trials showed direction errors ({:.0}%).",
                        anti.error_count,
                        anti.scored_count,
                        rate * 100.0
                    ),
                    why_it_matters: "Successful antisaccade performance reflects the ability to \
                        override an automatic orienting response — a core executive attention skill."
                        .to_string(),
                    possible_contributors: vec![],
                    confidence: confidence.clone(),
                    evidence: ScreeningEvidence {
                        metric: "antisaccade_error_rate".to_string(),
                        observed_value: rate,
                        reference_p25: Some(norms.p25),
                        reference_p50: Some(norms.p50),
                        reference_p75: Some(norms.p75),
                    },
                });
            }
        }
    }

    if let Some(pro) = trial_summaries.iter().find(|t| t.task_id == "prosaccade") {
        if pro.scored_count >= 4 && pro.mean_latency_ms > 0.0 {
            let norms = &age_band.prosaccade_latency_ms;
            if pro.mean_latency_ms > norms.p75 {
                insights.push(ScreeningInsight {
                    id: "slow_prosaccade_latency".to_string(),
                    construct: "orienting_speed".to_string(),
                    severity: "moderate".to_string(),
                    headline: "Slower shifts toward prosaccade targets".to_string(),
                    what_we_saw: format!(
                        "Mean cue-to-saccade latency was {:.0} ms across {} scored trials.",
                        pro.mean_latency_ms,
                        pro.scored_count
                    ),
                    why_it_matters: "Prosaccade latency reflects how quickly the eyes orient to a \
                        new target. Slower orienting can appear during fatigue or distraction; \
                        group differences in ADHD research are weaker than for antisaccade errors."
                        .to_string(),
                    possible_contributors: COMMON_CONFOUNDERS.iter().map(|s| s.to_string()).collect(),
                    confidence: confidence.clone(),
                    evidence: ScreeningEvidence {
                        metric: "prosaccade_latency_ms".to_string(),
                        observed_value: pro.mean_latency_ms,
                        reference_p25: Some(norms.p25),
                        reference_p50: Some(norms.p50),
                        reference_p75: Some(norms.p75),
                    },
                });
            }
        }
    }

    if let Some(fix) = features.iter().find(|f| f.task_id == "fixation") {
        let norms_pct = &age_band.fixation_on_target_pct;
        if fix.pct_on_screen < norms_pct.p25 {
            insights.push(ScreeningInsight {
                id: "fixation_drift".to_string(),
                construct: "sustained_attention".to_string(),
                severity: "moderate".to_string(),
                headline: "Limited time looking at the center during fixation".to_string(),
                what_we_saw: format!(
                    "On-screen attention at center was {:.0}% during the 35-second fixation period.",
                    fix.pct_on_screen
                ),
                why_it_matters: "Sustained fixation measures the ability to maintain visual \
                    attention on a single target — related to vigilance and distractibility in \
                    oculomotor research."
                    .to_string(),
                possible_contributors: COMMON_CONFOUNDERS.iter().map(|s| s.to_string()).collect(),
                confidence: confidence.clone(),
                evidence: ScreeningEvidence {
                    metric: "fixation_on_target_pct".to_string(),
                    observed_value: fix.pct_on_screen,
                    reference_p25: Some(norms_pct.p25),
                    reference_p50: Some(norms_pct.p50),
                    reference_p75: Some(norms_pct.p75),
                },
            });
        }

        let dur_norms = &age_band.fixation_duration_ms;
        if fix.mean_fixation_duration_ms > 0.0 && fix.mean_fixation_duration_ms < dur_norms.p25 {
            insights.push(ScreeningInsight {
                id: "short_fixations".to_string(),
                construct: "sustained_attention".to_string(),
                severity: "moderate".to_string(),
                headline: "Shorter fixations than typical during fixation".to_string(),
                what_we_saw: format!(
                    "Mean fixation duration was {:.0} ms ({} fixations detected).",
                    fix.mean_fixation_duration_ms,
                    fix.fixation_count
                ),
                why_it_matters: "Shorter fixations can reflect difficulty maintaining steady visual \
                    attention, though webcam-based gaze estimates are noisier than clinical eye trackers."
                    .to_string(),
                possible_contributors: COMMON_CONFOUNDERS.iter().map(|s| s.to_string()).collect(),
                confidence: confidence.clone(),
                evidence: ScreeningEvidence {
                    metric: "fixation_duration_ms".to_string(),
                    observed_value: fix.mean_fixation_duration_ms,
                    reference_p25: Some(dur_norms.p25),
                    reference_p50: Some(dur_norms.p50),
                    reference_p75: Some(dur_norms.p75),
                },
            });
        }

        let yaw_norms = &age_band.gaze_yaw_std;
        if fix.yaw_std > yaw_norms.p75 {
            insights.push(ScreeningInsight {
                id: "gaze_instability".to_string(),
                construct: "sustained_attention".to_string(),
                severity: "moderate".to_string(),
                headline: "Higher gaze variability during fixation".to_string(),
                what_we_saw: format!(
                    "Gaze stability (yaw variability) was {:.3} during fixation.",
                    fix.yaw_std
                ),
                why_it_matters: "Greater gaze variability during a steady fixation task can reflect \
                    difficulty maintaining visual focus, a pattern studied in attention research."
                    .to_string(),
                possible_contributors: COMMON_CONFOUNDERS.iter().map(|s| s.to_string()).collect(),
                confidence: confidence.clone(),
                evidence: ScreeningEvidence {
                    metric: "gaze_yaw_std".to_string(),
                    observed_value: fix.yaw_std,
                    reference_p25: Some(yaw_norms.p25),
                    reference_p50: Some(yaw_norms.p50),
                    reference_p75: Some(yaw_norms.p75),
                },
            });
        }
    }

    if let Some(story) = naturalistic {
        if story.sample_count >= 20 {
            let on_norms = &age_band.story_on_screen_pct;
            if story.on_screen_pct < on_norms.p25 {
                insights.push(ScreeningInsight {
                    id: "story_low_on_screen".to_string(),
                    construct: "ecological_attention".to_string(),
                    severity: "moderate".to_string(),
                    headline: "Less screen focus during the watch-along story".to_string(),
                    what_we_saw: format!(
                        "On-screen attention was {:.0}% during the {:.0}-second story phase.",
                        story.on_screen_pct,
                        story.sample_count as f32 * 0.05
                    ),
                    why_it_matters: "Naturalistic viewing measures sustained attention during \
                        engaging content — similar to joint-attention video paradigms in \
                        attention research."
                        .to_string(),
                    possible_contributors: COMMON_CONFOUNDERS.iter().map(|s| s.to_string()).collect(),
                    confidence: confidence.clone(),
                    evidence: ScreeningEvidence {
                        metric: "story_on_screen_pct".to_string(),
                        observed_value: story.on_screen_pct,
                        reference_p25: Some(on_norms.p25),
                        reference_p50: Some(on_norms.p50),
                        reference_p75: Some(on_norms.p75),
                    },
                });
            }

            let var_norms = &age_band.story_gaze_variability;
            if story.gaze_variability > var_norms.p75 {
                insights.push(ScreeningInsight {
                    id: "story_gaze_variability".to_string(),
                    construct: "ecological_attention".to_string(),
                    severity: "moderate".to_string(),
                    headline: "Higher gaze variability during the story".to_string(),
                    what_we_saw: format!(
                        "Gaze stability during the story was {:.3} (yaw variability).",
                        story.gaze_variability
                    ),
                    why_it_matters: "Greater gaze variability during sustained viewing can reflect \
                        difficulty maintaining visual focus on engaging content."
                        .to_string(),
                    possible_contributors: COMMON_CONFOUNDERS.iter().map(|s| s.to_string()).collect(),
                    confidence: confidence.clone(),
                    evidence: ScreeningEvidence {
                        metric: "story_gaze_variability".to_string(),
                        observed_value: story.gaze_variability,
                        reference_p25: Some(var_norms.p25),
                        reference_p50: Some(var_norms.p50),
                        reference_p75: Some(var_norms.p75),
                    },
                });
            }

            let decay_norms = &age_band.story_vigilance_decay_pct;
            if story.vigilance_decay < decay_norms.p25 {
                insights.push(ScreeningInsight {
                    id: "story_vigilance_decay".to_string(),
                    construct: "ecological_attention".to_string(),
                    severity: "moderate".to_string(),
                    headline: "Attention faded during the second half of the story".to_string(),
                    what_we_saw: format!(
                        "On-screen attention dropped {:.0} percentage points from the first to \
                         second half of the story.",
                        -story.vigilance_decay
                    ),
                    why_it_matters: "Vigilance decrement over time is studied in continuous \
                        performance and naturalistic viewing tasks as a marker of sustained \
                        attention fluctuations."
                        .to_string(),
                    possible_contributors: COMMON_CONFOUNDERS.iter().map(|s| s.to_string()).collect(),
                    confidence: confidence.clone(),
                    evidence: ScreeningEvidence {
                        metric: "story_vigilance_decay_pct".to_string(),
                        observed_value: story.vigilance_decay,
                        reference_p25: Some(decay_norms.p25),
                        reference_p50: Some(decay_norms.p50),
                        reference_p75: Some(decay_norms.p75),
                    },
                });
            }

            if story.lapse_episodes >= 2 {
                insights.push(ScreeningInsight {
                    id: "story_attention_lapses".to_string(),
                    construct: "ecological_attention".to_string(),
                    severity: "moderate".to_string(),
                    headline: "Brief attention lapses during the story".to_string(),
                    what_we_saw: format!(
                        "We detected {} episode(s) of looking away from the screen for 2+ seconds.",
                        story.lapse_episodes
                    ),
                    why_it_matters: "Extended gaze-away episodes during engaging viewing may reflect \
                        distractibility, though webcam gaze estimates are less precise than clinical \
                        eye tracking."
                        .to_string(),
                    possible_contributors: COMMON_CONFOUNDERS.iter().map(|s| s.to_string()).collect(),
                    confidence: confidence.clone(),
                    evidence: ScreeningEvidence {
                        metric: "story_lapse_episodes".to_string(),
                        observed_value: story.lapse_episodes as f32,
                        reference_p25: Some(0.0),
                        reference_p50: Some(1.0),
                        reference_p75: Some(2.0),
                    },
                });
            }
        }
    }

    if let Some(probes) = trial_summaries.iter().find(|t| t.task_id == "story_probe") {
        if probes.scored_count >= 2 {
            let follow_rate = 1.0 - probes.error_rate;
            let norms = &age_band.story_probe_follow_rate;
            if follow_rate < norms.p25 {
                insights.push(ScreeningInsight {
                    id: "story_probe_low_follow".to_string(),
                    construct: "ecological_attention".to_string(),
                    severity: "moderate".to_string(),
                    headline: "Fewer follows of character gaze during story probes".to_string(),
                    what_we_saw: format!(
                        "Followed character gaze on {} of {} scored story moments ({:.0}%).",
                        probes.scored_count - probes.error_count,
                        probes.scored_count,
                        follow_rate * 100.0
                    ),
                    why_it_matters: "Joint-attention probe moments measure whether the child orients \
                        to social gaze cues during engaging content — complementing antisaccade \
                        inhibition measured earlier."
                        .to_string(),
                    possible_contributors: COMMON_CONFOUNDERS.iter().map(|s| s.to_string()).collect(),
                    confidence: confidence.clone(),
                    evidence: ScreeningEvidence {
                        metric: "story_probe_follow_rate".to_string(),
                        observed_value: follow_rate,
                        reference_p25: Some(norms.p25),
                        reference_p50: Some(norms.p50),
                        reference_p75: Some(norms.p75),
                    },
                });
            }
        }
    }

    for f in features {
        if f.sample_count < 10 {
            insights.push(ScreeningInsight {
                id: format!("low_data_{}", f.task_id),
                construct: "data_validity".to_string(),
                severity: "info".to_string(),
                headline: format!("Limited samples for {}", f.task_id),
                what_we_saw: format!("Only {} samples recorded for task {}.", f.sample_count, f.task_id),
                why_it_matters: "Too few samples reduces confidence in task-specific metrics.".to_string(),
                possible_contributors: vec!["Camera obstruction or brief face loss".to_string()],
                confidence: "low".to_string(),
                evidence: ScreeningEvidence {
                    metric: "sample_count".to_string(),
                    observed_value: f.sample_count as f32,
                    reference_p25: Some(10.0),
                    reference_p50: None,
                    reference_p75: None,
                },
            });
        }
    }

    insights
}

pub fn assemble_deterministic_summary(
    insights: &[ScreeningInsight],
    quality: &ScreeningQuality,
    age: u8,
) -> String {
    let mut parts = Vec::new();

    parts.push(
        "This screening summarizes attention-related eye movement patterns from a short on-device \
         assessment. It is an attention-pattern aid, not a medical diagnosis."
            .to_string(),
    );

    if let Some(guidance) = &quality.retest_guidance {
        parts.push(guidance.clone());
        parts.push(
            "Because data quality was limited, the patterns below should be interpreted cautiously."
                .to_string(),
        );
    } else if insights.is_empty() {
        parts.push(format!(
            "For age {age}, no notable patterns stood out compared with approximate research \
             reference ranges. Continue using learning sessions for day-to-day attention feedback."
        ));
    } else {
        parts.push(format!(
            "For age {age}, we noted {} pattern(s) during fixation, prosaccade, antisaccade, \
             and story viewing tasks:",
            insights.len()
        ));
        for insight in insights {
            if insight.construct == "data_validity" {
                continue;
            }
            parts.push(format!(
                "• {} {} {}",
                insight.headline,
                insight.what_we_saw,
                insight.why_it_matters
            ));
            if !insight.possible_contributors.is_empty() {
                parts.push(format!(
                    "  Other factors that can affect this: {}.",
                    insight.possible_contributors.join("; ")
                ));
            }
        }
    }

    parts.push(
        "These tasks measure observable executive attention behaviors (sustained focus, orienting, \
         inhibition, and naturalistic viewing) studied in ADHD oculomotor research. They do not \
         measure brainwaves or replace evaluation by a qualified clinician."
            .to_string(),
    );

    parts.join("\n\n")
}

pub fn build_report_context(
    app: &tauri::AppHandle,
    features: &[ScreeningFeatureSet],
    trial_summaries: &[TrialTaskSummary],
    naturalistic: Option<&NaturalisticFeatureSet>,
) -> (ScreeningQuality, Vec<ScreeningInsight>, String, u8) {
    let inference = get_inference_status().unwrap_or(crate::vision::InferenceStatus {
        model_version: "unavailable".to_string(),
        engagement_loaded: false,
        affect_loaded: false,
        gaze_loaded: false,
        affect_source: "heuristic".to_string(),
    });

    let quality = assess_quality(
        features,
        trial_summaries,
        &inference.model_version,
        inference.gaze_loaded,
    );

    let norms = load_norms();
    let age = parse_child_age(app);
    let band = band_for_age(&norms, age);
    let insights = build_insights(features, trial_summaries, naturalistic, &quality, band);
    let summary = assemble_deterministic_summary(&insights, &quality, age);

    (quality, insights, summary, age)
}

// Legacy flags for backward compatibility
pub fn insights_to_flags(insights: &[ScreeningInsight]) -> Vec<crate::screening::ScreeningFlag> {
    insights
        .iter()
        .map(|i| crate::screening::ScreeningFlag {
            code: i.id.clone(),
            message: format!("{} {}", i.headline, i.what_we_saw),
            severity: i.severity.clone(),
        })
        .collect()
}

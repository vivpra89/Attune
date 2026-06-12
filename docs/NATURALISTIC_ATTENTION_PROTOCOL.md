# Naturalistic Story Attention Protocol

**Status:** Implemented (screening phase 4)  
**Last updated:** May 2026

This document describes the watch-along story phase added after fixation, prosaccade, and antisaccade tasks in Attune screening.

---

## Purpose

Measure **ecological sustained attention** and **social gaze following** during engaging visual content — complementing executive oculomotor tasks without replacing them.

This is a **structured watch-along protocol**, not an interactive game. The child does not tap, score points, or respond with buttons.

---

## Screening flow

1. Fixation (35s) — baseline yaw calibration + sustained attention on static target  
2. Prosaccade (8 trials) — orienting  
3. Antisaccade (8 trials) — response inhibition  
4. **Naturalistic viewing (~80s)** — illustrated story with joint-attention probes  

Total active time: ~4 minutes.

---

## Story protocol

Defined in [`attune-app/public/story_attention_manifest.json`](../attune-app/public/story_attention_manifest.json) and mirrored in [`storyAttentionManifest.ts`](../attune-app/src/config/storyAttentionManifest.ts).

- 4 scenes with gradual crossfade transitions (~800ms)  
- 3 timed probes where the character looks left or right  
- Instruction: *"Watch the story. When the character looks somewhere, look there too."*  
- No reading required; minimal on-screen text  

---

## Constructs and metrics

### Continuous (`task_id = naturalistic_viewing`)

| Metric | Definition |
|--------|------------|
| `on_screen_pct` | % samples with `gaze_away < 0.45` and face present |
| `gaze_variability` | Standard deviation of yaw during story |
| `engagement_mean` | Mean engagement model output |
| `vigilance_decay` | On-screen % in second half minus first half |
| `lapse_episodes` | Count of ≥2s periods with `gaze_away > 0.6` |

### Event-aligned (`task_id = story_probe`)

Reuses prosaccade trial scoring: did the first post-cue saccade match the character's gaze direction?

| Metric | Definition |
|--------|------------|
| `probe_follow_rate` | 1 − direction error rate across scored probes |
| `probe_mean_latency_ms` | Mean cue-to-saccade latency |

Report construct: **`ecological_attention`**

---

## Research basis

| Element | Reference |
|---------|-----------|
| Multi-task oculomotor battery first | Frontiers 2023 tablet ADHD eye-tracking; Attune EEG roadmap Phase 0 |
| Naturalistic viewing adds signal | Nature Sci Reports 2022 — VR naturalistic eye movements discriminate ADHD beyond lab tasks |
| Joint-attention video probes | Marotta et al., Dev Psychopathol — RJA gaze patterns differ in ADHD |
| Gradual transitions | gradCPT (Rosenberg et al. 2013) — reduces exogenous capture vs abrupt CPT stimuli |
| Gaze-only CPT enhancement | Elbaum et al. 2020 — MOXO-dCPT + eye tracking improves group classification |
| Vigilance decrement | Continuous performance task literature |

Age-banded reference values in [`screening_norms.json`](../attune-app/src-tauri/resources/screening_norms.json) are **approximate literature-seeded placeholders**, not diagnostic cutoffs. Calibrate from labeled cohort over time.

---

## Confounders

Same as oculomotor screening (`insights.rs` `COMMON_CONFOUNDERS`):

- Poor sleep or fatigue  
- Illness or medication effects  
- Anxiety or first-time task novelty  
- Screen distance or lighting  
- Webcam gaze is less precise than clinical eye tracking  

---

## Non-diagnostic disclaimer

Story metrics describe **attention-related eye movement patterns** during a short on-device assessment. They do not diagnose ADHD, replace clinical evaluation, or measure EEG/brainwaves.

---

## Future (v2)

- Optional distractor scenes (MOXO-style ecological distractors)  
- Age-specific story manifests  
- Fusion with Core ML classifier after cohort calibration  
- Optional soft narration (currently silent to reduce confounds)

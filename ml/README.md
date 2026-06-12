# Attune ML pipeline

**You do not need Attune session data to run inference.** Use public pretrained weights + Apple Vision.

## What runs on device (default after bootstrap)

| Component | Source | Role |
|-----------|--------|------|
| Face + landmarks | Apple `VNDetectFaceLandmarks` | Face present, eye openness, head pose |
| **Affect** | **HSEmotion `enet_b0_8_best_afew`** — [av-savchenko/hsemotion](https://github.com/av-savchenko/hsemotion) (MIT) | 224×224 face crop → 8 emotion logits → remapped to Attune 5 classes |
| **Gaze-away** | **MobileOne-S0 (Gaze360)** — [yakhyo/gaze-estimation](https://github.com/yakhyo/gaze-estimation) | Pretrained CNN on face crop → `gaze_away`, yaw/pitch proxies |
| Engagement | Derived fusion from affect + gaze + face quality | No public engagement checkpoint required |
| Screening | Engineered oculomotor features | Non-diagnostic report (no labeled cohort required) |

## Pretrained affect (HSEmotion)

Convert the EfficientNet-B0 AffectNet checkpoint to Core ML:

```bash
cd attune-app && npm run convert:affect
```

This writes `AttuneAffect.mlmodel` (224×224 RGB input named `face`, 8 logits output) and verifies I/O via `verify_models.py`.

**8→5 label remap** (see `affect_label_map.json`):

| HSEmotion | Attune |
|-----------|--------|
| Happiness | engaged |
| Sadness | bored |
| Fear | confused |
| Surprise | neutral |
| Anger, Contempt, Disgust | frustrated |
| Neutral | neutral |

**Attribution:** HSEmotion is MIT-licensed ([GitHub](https://github.com/av-savchenko/hsemotion)).

**Engagement fusion** (when HSEmotion is active — see `constants.py`):

```
engagement = clamp(
  0.35 × prob_engaged + 0.25 × (1 − gaze_away) + 0.20 × face_quality/100
  + 0.10 × eye_open + 0.10 × (1 − prob_bored), 0, 1)
```

Optional landmark `AttuneEngagement.mlmodel` is blended 50/50 when present.

## One-time setup (no training data)

```bash
./scripts/bootstrap_inference.sh
```

This will:

1. Download **mobileone_s0_fused.pt** (~5 MB) from the gaze-estimation release
2. Export **AttuneGazePretrained.mlmodel** (+ compile to `.mlmodelc`)
3. Build lightweight **AttuneEngagement** / **AttuneAffect** landmark nets (structure only; heuristics remain primary)

Then rebuild the app:

```bash
cd attune-app && npm run tauri build
```

### Manual steps

```bash
cd ml && pip install -r requirements.txt
python download_pretrained.py --compile
python generate_v0_models.py --compile --skip-gaze
```

## Inference modes

| `model_version` | Meaning |
|-----------------|--------|
| `coreml-hsemotion-v1.0` | HSEmotion affect + pretrained gaze loaded |
| `coreml-partial-v1.0` | Some Core ML models loaded (affect and/or gaze and/or engagement) |
| `heuristic-v0.1` | Apple Vision heuristics only (models missing) |
| `mobilegaze-gaze360-v1` | Legacy gaze-only label (superseded by hsemotion bundle) |

Check in the parent dashboard via `get_inference_status` (`affect_source`: `hsemotion`, `landmark`, or `heuristic`).

## Optional: train on your data later

Only if you collect sessions and labels:

```bash
python export_session_features.py
python train_from_sessions.py --compile
python train_screening_classifier.py   # needs ≥50 labeled screenings
```

## Tier 2 (deferred): higher-precision screen gaze

See [yakhyo/gaze-estimation](https://yakhyo.github.io/gaze-estimation/) (ResNet/MobileNet), [MGazeNet](https://github.com/GanchengZhu/PhoneRealTimeGazeEstimation). Same export path as `download_pretrained.py` with a different `--arch` if coarse gaze is insufficient.

## Regulatory note

Screening output is an **attention-pattern aid**, not ADHD diagnosis.

## Calibration study (optional)

To enable the on-device research classifier (`AttuneScreening.mlmodel`):

1. Collect ≥50 completed screenings with optional parent/clinician labels via the report UI (`save_screening_label`).
2. Export features: `python export_session_features.py` (includes screening samples + labels).
3. Train: `python train_screening_classifier.py --db ~/Library/Application\ Support/ai.attune.app/attune.db`
4. Rebuild the app so `AttuneScreening.mlmodelc` is bundled under `attune-app/models/`.

The classifier runs via Core ML only when `screening_classifier_validated=true` in settings (set automatically when cross-val AUC ≥ 0.72). Until then, deterministic insights and trial-level antisaccade scoring provide science-based summaries without ML.

Labels are stored locally as `label` 0/1 on `screening_sessions` with `label_source` (e.g. `parent_clinical_hint`). These are for research calibration only—not ground-truth diagnosis.

## Future: EEG integration

Attune does **not** ship EEG today. See [docs/EEG_INTEGRATION_ROADMAP.md](../docs/EEG_INTEGRATION_ROADMAP.md) for the phased plan:

1. **Hardware layer** — Muse / Emotiv / OpenBCI ingest with quality gates  
2. **qEEG baseline** — IAF-aware phenotype tags (not TBR diagnosis)  
3. **NF protocols** — theta/beta or SMR during learning sessions with compliance metrics  
4. **Multimodal fusion** — oculomotor + EEG with disagreement downgrading  
5. **Clinical validation** — IRB + sham-controlled trials before treatment claims  

In-app summary: Parent dashboard → **Science**.

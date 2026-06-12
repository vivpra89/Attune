"""Shared constants for Attune ML training and inference."""

# 8 landmark regions × 4 floats (width, height, centerX, centerY)
FEATURE_DIM = 32

GAZE_FEATURE_DIM = 3

AFFECT_CLASSES = ["engaged", "bored", "confused", "frustrated", "neutral"]

MODEL_NAMES = {
    "engagement": "AttuneEngagement",
    "affect": "AttuneAffect",
    "gaze": "AttuneGazeAway",
}

# Derived engagement fusion (used when HSEmotion affect is active).
# engagement = clamp(sum(weight_i * signal_i), 0, 1)
ENGAGEMENT_FUSION_WEIGHTS = {
    "prob_engaged": 0.35,
    "gaze_present": 0.25,
    "face_quality": 0.20,
    "eye_open": 0.10,
    "anti_bored": 0.10,
}

HSEMOTION_AFFECT_INPUT = "face"
HSEMOTION_AFFECT_OUTPUT = "emotion_logits"
HSEMOTION_IMG_SIZE = 224

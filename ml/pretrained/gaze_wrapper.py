"""MobileGaze (L2CS-style) wrapper for Core ML export — Gaze360 binned head."""

from __future__ import annotations

import torch
import torch.nn as nn
import torch.nn.functional as F

from pretrained.mobileone import mobileone_s0, reparameterize_model

# Gaze360 dataset config (yakhyo/gaze-estimation)
GAZE360_BINS = 90
GAZE360_BINWIDTH = 4
GAZE360_ANGLE = 180


class Gaze360MobileOne(nn.Module):
    def __init__(self, bins: int = GAZE360_BINS):
        super().__init__()
        self.bins = bins
        self.binwidth = GAZE360_BINWIDTH
        self.angle = GAZE360_ANGLE
        self.backbone = mobileone_s0(pretrained=False, num_classes=bins, inference_mode=True)
        self.register_buffer("idx_tensor", torch.arange(bins, dtype=torch.float32))

    def forward(self, image: torch.Tensor) -> tuple[torch.Tensor, torch.Tensor, torch.Tensor]:
        """image: NCHW float32, ImageNet-normalized 448x448."""
        yaw_logits, pitch_logits = self.backbone(image)
        yaw_prob = F.softmax(yaw_logits, dim=1)
        pitch_prob = F.softmax(pitch_logits, dim=1)
        yaw_deg = torch.sum(yaw_prob * self.idx_tensor, dim=1) * self.binwidth - self.angle
        pitch_deg = torch.sum(pitch_prob * self.idx_tensor, dim=1) * self.binwidth - self.angle
        # Coarse gaze-away proxy: larger angular deviation from center → higher probability
        gaze_away = torch.clamp((torch.abs(yaw_deg) + torch.abs(pitch_deg)) / 90.0, 0.0, 1.0)
        yaw_norm = torch.clamp(torch.abs(yaw_deg) / 90.0, 0.0, 1.0)
        pitch_norm = torch.clamp(torch.abs(pitch_deg) / 90.0, 0.0, 1.0)
        return gaze_away, yaw_norm, pitch_norm


def load_pretrained_gaze(weights_path: str) -> Gaze360MobileOne:
    model = Gaze360MobileOne()
    state = torch.load(weights_path, map_location="cpu")
    if isinstance(state, dict) and "state_dict" in state:
        state = state["state_dict"]
    model.backbone.load_state_dict(state, strict=False)
    if not getattr(model.backbone, "inference_mode", False):
        model.backbone = reparameterize_model(model.backbone)
    model.eval()
    return model

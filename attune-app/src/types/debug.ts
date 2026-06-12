export type FeedbackState =
  | "focused"
  | "soft_nudge"
  | "dimmed"
  | "break_suggest"
  | "confusion_help"
  | "hyperfocus_redirect";

export interface AttentionSample {
  score: number;
  face_present: boolean;
  timestamp: number;
  face_quality: number;
  eye_openness: number;
  head_pose_penalty: number;
  emotion: string;
  emotion_confidence: number;
  engagement_prob: number;
  gaze_away_prob: number;
  prob_engaged: number;
  prob_bored: number;
  prob_confused: number;
  prob_frustrated: number;
  prob_neutral: number;
  yaw: number;
  pitch: number;
  model_version: string;
}

export interface FeedbackUpdate {
  state: FeedbackState;
  opacity: number;
  smoothed_score: number;
  effective_score: number;
  emotion: string;
  child_message: string;
  show_reengage: boolean;
  show_break_prompt: boolean;
  show_confusion_help: boolean;
  primary_distraction: string | null;
  face_missing_secs: number;
  state_duration_secs: number;
}

export interface DistractionEvent {
  kind: string;
  severity: number;
  confidence: number;
  ts: number;
  app_bundle_id: string | null;
  metadata: string | null;
}

export interface DistractionState {
  primary: string | null;
  active: string[];
  events: DistractionEvent[];
  task_switch_count_60s: number;
  current_app_bundle: string | null;
  current_app_dwell_secs: number;
}

export interface SessionDebugTick {
  ts: number;
  session_id: string;
  vision: AttentionSample;
  app_name: string | null;
  app_bundle: string | null;
  distraction: DistractionState;
  feedback: FeedbackUpdate;
}

export interface DebugLogEntry {
  id: number;
  ts: number;
  message: string;
}

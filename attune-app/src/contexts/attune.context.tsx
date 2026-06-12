import {
  ReactNode,
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

interface AttentionSample {
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
  model_version: string;
}

export type FeedbackState =
  | "focused"
  | "soft_nudge"
  | "dimmed"
  | "break_suggest"
  | "confusion_help"
  | "hyperfocus_redirect";

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
  primary_distraction?: string | null;
  face_missing_secs?: number;
}

interface AttuneContextValue {
  attentionScore: number;
  facePresent: boolean;
  emotion: string;
  engagementProb: number;
  gazeAwayProb: number;
  modelVersion: string;
  feedbackState: FeedbackState;
  childMessage: string;
  primaryDistraction: string | null;
  activeSessionId: string | null;
  isUnlocked: boolean;
  setUnlocked: (v: boolean) => void;
  refreshSession: () => Promise<void>;
  startSession: () => Promise<void>;
  stopSession: () => Promise<void>;
}

const AttuneContext = createContext<AttuneContextValue | null>(null);

export function AttuneProvider({ children }: { children: ReactNode }) {
  const [attentionScore, setAttentionScore] = useState(100);
  const [facePresent, setFacePresent] = useState(true);
  const [emotion, setEmotion] = useState("unknown");
  const [engagementProb, setEngagementProb] = useState(1);
  const [gazeAwayProb, setGazeAwayProb] = useState(0);
  const [modelVersion, setModelVersion] = useState("heuristic-v0.1");
  const [feedbackState, setFeedbackState] = useState<FeedbackState>("focused");
  const [childMessage, setChildMessage] = useState("Here");
  const [primaryDistraction, setPrimaryDistraction] = useState<string | null>(null);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [isUnlocked, setUnlocked] = useState(false);

  const refreshSession = useCallback(async () => {
    try {
      const id = await invoke<string | null>("get_active_session");
      setActiveSessionId(id);
    } catch {
      setActiveSessionId(null);
    }
  }, []);

  useEffect(() => {
    refreshSession();
    const unlistenSample = listen<AttentionSample>("attention-sample", (event) => {
      setAttentionScore(event.payload.score);
      setFacePresent(event.payload.face_present);
      setEmotion(event.payload.emotion);
      setEngagementProb(event.payload.engagement_prob);
      setGazeAwayProb(event.payload.gaze_away_prob);
      setModelVersion(event.payload.model_version);
    });
    const unlistenFeedback = listen<FeedbackUpdate>("feedback-update", (event) => {
      setFeedbackState(event.payload.state);
      setChildMessage(event.payload.child_message);
      setAttentionScore(event.payload.smoothed_score);
      setEmotion(event.payload.emotion);
      setPrimaryDistraction(event.payload.primary_distraction ?? null);
    });
    return () => {
      unlistenSample.then((fn) => fn());
      unlistenFeedback.then((fn) => fn());
    };
  }, [refreshSession]);

  const startSession = async () => {
    const id = await invoke<string>("start_session");
    setActiveSessionId(id);
    setFeedbackState("focused");
    setChildMessage("Here");
    setPrimaryDistraction(null);
  };

  const stopSession = async () => {
    await invoke("end_session");
    setActiveSessionId(null);
    setFeedbackState("focused");
    setChildMessage("Here");
    setPrimaryDistraction(null);
  };

  return (
    <AttuneContext.Provider
      value={{
        attentionScore,
        facePresent,
        emotion,
        engagementProb,
        gazeAwayProb,
        modelVersion,
        feedbackState,
        childMessage,
        primaryDistraction,
        activeSessionId,
        isUnlocked,
        setUnlocked,
        refreshSession,
        startSession,
        stopSession,
      }}
    >
      {children}
    </AttuneContext.Provider>
  );
}

export function useAttune() {
  const ctx = useContext(AttuneContext);
  if (!ctx) throw new Error("useAttune must be used within AttuneProvider");
  return ctx;
}

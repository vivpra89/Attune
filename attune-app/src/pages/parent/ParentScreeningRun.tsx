import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useNavigate, Navigate } from "react-router-dom";
import { useAttune } from "@/contexts/attune.context";
import { Button } from "@/components/ui/button";
import { STORY_MANIFEST } from "@/config/storyAttentionManifest";
import {
  StoryAttentionPlayer,
  beginNaturalisticPhase,
  recordStoryProbe,
} from "@/pages/parent/StoryAttentionPlayer";

const PRO_TRIALS = 8;
const ANTI_TRIALS = 8;
const FIXATION_SEC = 35;

type Phase =
  | "intro"
  | "fixation"
  | "prosaccade"
  | "antisaccade"
  | "naturalistic_viewing"
  | "done"
  | "error";

function randomSide(): "left" | "right" {
  return Math.random() < 0.5 ? "left" : "right";
}

function TargetDot({ side }: { side: "left" | "right" | "center" }) {
  const pos =
    side === "center"
      ? "left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
      : side === "left"
        ? "left-[18%] top-1/2 -translate-y-1/2"
        : "right-[18%] top-1/2 -translate-y-1/2";
  return (
    <div
      className={`absolute size-5 rounded-full bg-primary shadow-lg ring-4 ring-primary/30 ${pos}`}
      aria-hidden
    />
  );
}

export function ParentScreeningRun() {
  const { isUnlocked } = useAttune();
  const navigate = useNavigate();
  const [phase, setPhase] = useState<Phase>("intro");
  const [screeningId, setScreeningId] = useState<string | null>(null);
  const [countdown, setCountdown] = useState(FIXATION_SEC);
  const [trial, setTrial] = useState(0);
  const [cueSide, setCueSide] = useState<"left" | "right">("left");
  const [error, setError] = useState<string | null>(null);
  const startedRef = useRef(false);
  const recordedTrialsRef = useRef(new Set<string>());

  const setTask = useCallback(async (taskId: string) => {
    await invoke("set_screening_task", { taskId });
  }, []);

  const recordTrial = useCallback(
    async (taskId: string, trialIndex: number, side: "left" | "right") => {
      const key = `${taskId}-${trialIndex}`;
      if (recordedTrialsRef.current.has(key)) return;
      recordedTrialsRef.current.add(key);
      const cueOnsetTs = await invoke<number>("get_screening_timestamp");
      await invoke("record_screening_trial", {
        taskId,
        trialIndex,
        cueSide: side,
        cueOnsetTs,
      });
    },
    [],
  );

  const handleStoryComplete = useCallback(() => {
    setPhase("done");
  }, []);

  const handleRecordProbe = useCallback(
    async (probeIndex: number, cueSide: "left" | "right") => {
      await recordStoryProbe(probeIndex, cueSide);
    },
    [],
  );

  useEffect(() => {
    if (!isUnlocked || startedRef.current) return;
    startedRef.current = true;
    (async () => {
      try {
        const perm = await invoke<number>("check_camera_permission");
        if (perm !== 2) {
          await invoke("request_camera_permission");
        }
        const existing = await invoke<string | null>("get_active_screening");
        const id = existing ?? (await invoke<string>("start_screening"));
        setScreeningId(id);
        await setTask("fixation");
        setPhase("fixation");
      } catch (e) {
        setError(String(e));
        setPhase("error");
      }
    })();
  }, [isUnlocked, setTask]);

  useEffect(() => {
    if (phase !== "fixation") return;
    if (countdown <= 0) {
      (async () => {
        await setTask("prosaccade");
        setTrial(0);
        const side = randomSide();
        setCueSide(side);
        setPhase("prosaccade");
      })();
      return;
    }
    const t = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [phase, countdown, setTask]);

  useEffect(() => {
    if (phase !== "prosaccade" && phase !== "antisaccade") return;
    void recordTrial(phase, trial, cueSide);
  }, [phase, trial, cueSide, recordTrial]);

  useEffect(() => {
    if (phase !== "prosaccade" && phase !== "antisaccade") return;
    const duration = phase === "prosaccade" ? 1200 : 1500;
    const t = setTimeout(async () => {
      const max = phase === "prosaccade" ? PRO_TRIALS : ANTI_TRIALS;
      if (trial + 1 >= max) {
        if (phase === "prosaccade") {
          await setTask("antisaccade");
          setTrial(0);
          setCueSide(randomSide());
          setPhase("antisaccade");
        } else {
          await beginNaturalisticPhase();
          setPhase("naturalistic_viewing");
        }
      } else {
        setTrial((t) => t + 1);
        setCueSide(randomSide());
      }
    }, duration);
    return () => clearTimeout(t);
  }, [phase, trial, setTask]);

  useEffect(() => {
    if (phase !== "done" || !screeningId) return;
    (async () => {
      try {
        await invoke("end_screening");
        navigate(`/parent/screening/report/${screeningId}`);
      } catch (e) {
        setError(String(e));
        setPhase("error");
      }
    })();
  }, [phase, screeningId, navigate]);

  if (!isUnlocked) return <Navigate to="/parent" replace />;

  if (phase === "error") {
    return (
      <div className="space-y-4 max-w-lg">
        <p className="text-destructive">{error ?? "Something went wrong."}</p>
        <Button variant="outline" onClick={() => navigate("/parent/screening")}>
          Back
        </Button>
      </div>
    );
  }

  if (phase === "intro") {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <p className="text-muted-foreground">Starting camera…</p>
      </div>
    );
  }

  const instruction =
    phase === "fixation"
      ? "Look at the dot in the center"
      : phase === "prosaccade"
        ? `Trial ${trial + 1}/${PRO_TRIALS} — Look at the dot`
        : phase === "antisaccade"
          ? `Trial ${trial + 1}/${ANTI_TRIALS} — Look away from the dot (opposite side)`
          : phase === "naturalistic_viewing"
            ? STORY_MANIFEST.instruction
            : "Finishing…";

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background">
      <div className="px-8 py-4 border-b border-border flex justify-between items-center">
        <p className="text-sm font-medium">{instruction}</p>
        {phase === "fixation" && (
          <span className="text-sm text-muted-foreground tabular-nums">{countdown}s</span>
        )}
      </div>

      <div className="relative flex-1 bg-muted/30 flex flex-col">
        {phase === "fixation" && <TargetDot side="center" />}
        {(phase === "prosaccade" || phase === "antisaccade") && <TargetDot side={cueSide} />}
        {phase === "naturalistic_viewing" && (
          <StoryAttentionPlayer
            onComplete={handleStoryComplete}
            recordProbe={handleRecordProbe}
          />
        )}
      </div>

      <div className="px-8 py-3 border-t border-border">
        <p className="text-xs text-muted-foreground text-center">
          Screening aid only — not a diagnosis. All processing on this device.
        </p>
      </div>
    </div>
  );
}

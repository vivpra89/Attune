import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useNavigate, useParams, Navigate } from "react-router-dom";
import { useAttune } from "@/contexts/attune.context";
import { Button } from "@/components/ui/button";

interface TrainingSessionReport {
  session_id: string;
  mission_minutes: number;
  world_id: number;
  steer_accuracy: number;
  tap_accuracy: number;
  multitask_cost: number;
  gaze_engagement: number;
  mean_rt_ms: number;
  run_count: number;
  difficulty_final: {
    steer_speed: number;
    target_rate: number;
    distractor_ratio: number;
    rule_complexity: number;
  };
}

export function ParentTrainReport() {
  const { isUnlocked } = useAttune();
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const [report, setReport] = useState<TrainingSessionReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isUnlocked || !sessionId) return;
    invoke<TrainingSessionReport>("get_training_report", { sessionId })
      .then(setReport)
      .catch((e) => setError(String(e)));
  }, [isUnlocked, sessionId]);

  if (!isUnlocked) return <Navigate to="/parent" replace />;

  if (error) {
    return (
      <div className="space-y-4">
        <p className="text-destructive">{error}</p>
        <Button variant="ghost" onClick={() => navigate("/parent/train")}>
          Back to Train
        </Button>
      </div>
    );
  }

  if (!report) {
    return <p className="text-muted-foreground">Loading report…</p>;
  }

  const pct = (v: number) => `${Math.round(v * 100)}%`;

  return (
    <div className="space-y-8 max-w-2xl">
      <div>
        <Button variant="ghost" size="sm" onClick={() => navigate("/parent/train")}>
          ← Back to Train
        </Button>
        <h1 className="text-2xl font-semibold mt-4">Mission summary</h1>
        <p className="text-muted-foreground text-sm mt-2">
          {report.mission_minutes.toFixed(1)} minutes · World {report.world_id} ·{" "}
          {report.run_count} adaptive adjustments
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="rounded-xl border border-border p-4">
          <p className="text-sm text-muted-foreground">Steer accuracy</p>
          <p className="text-2xl font-semibold">{pct(report.steer_accuracy)}</p>
        </div>
        <div className="rounded-xl border border-border p-4">
          <p className="text-sm text-muted-foreground">Tap accuracy</p>
          <p className="text-2xl font-semibold">{pct(report.tap_accuracy)}</p>
        </div>
        <div className="rounded-xl border border-border p-4">
          <p className="text-sm text-muted-foreground">Multitask cost</p>
          <p className="text-2xl font-semibold">{pct(report.multitask_cost)}</p>
          <p className="text-xs text-muted-foreground mt-1">
            Lower is better — less drop-off when combining tasks
          </p>
        </div>
        <div className="rounded-xl border border-border p-4">
          <p className="text-sm text-muted-foreground">Gaze engagement</p>
          <p className="text-2xl font-semibold">{pct(report.gaze_engagement)}</p>
          <p className="text-xs text-muted-foreground mt-1">From webcam during mission</p>
        </div>
      </div>

      <div className="rounded-xl border border-border p-4 text-sm space-y-2">
        <p className="font-medium">Difficulty after mission</p>
        <p className="text-muted-foreground">
          Steer speed {report.difficulty_final.steer_speed.toFixed(2)} · Target rate{" "}
          {report.difficulty_final.target_rate.toFixed(2)} · Distractors{" "}
          {pct(report.difficulty_final.distractor_ratio)}
        </p>
        <p className="text-muted-foreground">
          Mean reaction time: {Math.round(report.mean_rt_ms)} ms
        </p>
      </div>

      <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4 text-sm">
        <p className="text-muted-foreground">
          There is no &quot;win&quot; in Train mode — effort and consistent practice matter
          most. This summary describes exercise performance, not a clinical outcome.
        </p>
      </div>

      <Button onClick={() => navigate("/parent/train")}>Done</Button>
    </div>
  );
}

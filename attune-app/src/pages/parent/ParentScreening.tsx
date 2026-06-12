import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useNavigate, Navigate } from "react-router-dom";
import { useAttune } from "@/contexts/attune.context";
import { Button } from "@/components/ui/button";

interface ScreeningSessionRow {
  id: string;
  started_at: number;
  ended_at: number | null;
  report_json: string | null;
}

export function ParentScreening() {
  const { isUnlocked } = useAttune();
  const navigate = useNavigate();
  const [sessions, setSessions] = useState<ScreeningSessionRow[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);

  useEffect(() => {
    if (!isUnlocked) return;
    invoke<ScreeningSessionRow[]>("list_screening_sessions", { limit: 10 })
      .then(setSessions)
      .catch(console.error);
    invoke<string | null>("get_active_screening")
      .then(setActiveId)
      .catch(console.error);
  }, [isUnlocked]);

  if (!isUnlocked) return <Navigate to="/parent" replace />;

  const formatTime = (ts: number) =>
    new Date(ts * 1000).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });

  return (
    <div className="space-y-8 max-w-2xl">
      <div>
        <h1 className="text-2xl font-semibold">Attention screening</h1>
        <p className="text-muted-foreground text-sm mt-2 leading-relaxed">
          A short, on-device eye-movement assessment (about 4 minutes). Results describe
          attention patterns with an evidence-based summary — not a medical diagnosis. Video
          never leaves this Mac.
        </p>
      </div>

      <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 text-sm">
        <p className="font-medium text-amber-900 dark:text-amber-200">Before you begin</p>
        <ul className="mt-2 list-disc pl-5 space-y-1 text-muted-foreground">
          <li>Includes a short watch-along story at the end (no tapping required)</li>
          <li>Child sits arm&apos;s length from the screen, face visible to the camera</li>
          <li>Quiet room, screen brightness comfortable</li>
          <li>Stop any active learning session first</li>
          <li>
            Pretrained gaze model recommended — run{" "}
            <code className="text-xs">./scripts/bootstrap_inference.sh</code> if not done yet
          </li>
        </ul>
      </div>

      <div className="flex gap-3">
        {activeId ? (
          <Button onClick={() => navigate("/parent/screening/run")}>Resume screening</Button>
        ) : (
          <Button onClick={() => navigate("/parent/screening/run")}>Start screening</Button>
        )}
      </div>

      {sessions.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-lg font-medium">Past screenings</h2>
          {sessions.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => navigate(`/parent/screening/report/${s.id}`)}
              className="w-full text-left rounded-xl border border-border p-4 hover:bg-muted/50 transition-colors"
            >
              <p className="font-medium">{formatTime(s.started_at)}</p>
              <p className="text-sm text-muted-foreground">
                {s.ended_at ? "Completed — view report" : "In progress"}
              </p>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

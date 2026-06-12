import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useAttune } from "@/contexts/attune.context";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Navigate } from "react-router-dom";

interface SessionSummary {
  id: string;
  started_at: number;
  ended_at: number | null;
  summary_text: string | null;
  avg_score: number | null;
}

export function ParentToday() {
  const { isUnlocked, activeSessionId, startSession, stopSession, childMessage, feedbackState } =
    useAttune();
  const navigate = useNavigate();
  const [sessions, setSessions] = useState<SessionSummary[]>([]);

  useEffect(() => {
    if (!isUnlocked) return;
    invoke<SessionSummary[]>("list_sessions", { limit: 20 })
      .then(setSessions)
      .catch(console.error);
    invoke("ensure_weekly_report").catch(console.error);
  }, [isUnlocked, activeSessionId]);

  if (!isUnlocked) return <Navigate to="/parent" replace />;

  const formatTime = (ts: number) =>
    new Date(ts * 1000).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold">Today&apos;s Sessions</h1>
        <p className="text-muted-foreground text-sm mt-1">
          <strong className="font-medium text-foreground">Attune</strong> — start monitoring when
          your child begins homework. Use{" "}
          <button
            type="button"
            className="underline hover:text-foreground"
            onClick={() => navigate("/parent/screening")}
          >
            Screen
          </button>{" "}
          for assessment and{" "}
          <button
            type="button"
            className="underline hover:text-foreground"
            onClick={() => navigate("/parent/train")}
          >
            Train
          </button>{" "}
          for adaptive attention exercises.
        </p>
      </div>

      <div className="rounded-xl border border-border p-6 flex items-center justify-between gap-4">
        <div>
          <p className="font-medium">
            {activeSessionId ? "Session active" : "No active session"}
          </p>
          {activeSessionId && (
            <p className="text-sm text-muted-foreground mt-1">
              {childMessage}
              <span className="opacity-70"> · {feedbackState.replace(/_/g, " ")}</span>
            </p>
          )}
        </div>
        <div className="flex gap-2">
          {activeSessionId ? (
            <Button variant="destructive" onClick={() => stopSession()}>
              Stop Session
            </Button>
          ) : (
            <Button onClick={() => startSession()}>Start Session</Button>
          )}
        </div>
      </div>

      <div className="space-y-3">
        <h2 className="text-lg font-medium">Recent sessions</h2>
        {sessions.length === 0 && (
          <p className="text-sm text-muted-foreground">No sessions yet.</p>
        )}
        {sessions.map((s) => (
          <button
            key={s.id}
            onClick={() => navigate(`/parent/session/${s.id}`)}
            className="w-full text-left rounded-xl border border-border p-4 hover:bg-muted/50 transition-colors"
          >
            <div className="flex justify-between items-start">
              <div>
                <p className="font-medium">{formatTime(s.started_at)}</p>
                {s.avg_score != null && (
                  <p className="text-sm text-muted-foreground">
                    Avg attention: {Math.round(s.avg_score)}/100
                  </p>
                )}
              </div>
              <span className="text-xs text-muted-foreground">
                {s.ended_at ? "Completed" : "In progress"}
              </span>
            </div>
            {s.summary_text && (
              <p className="text-sm text-muted-foreground mt-2 line-clamp-2">
                {s.summary_text}
              </p>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useParams, Navigate } from "react-router-dom";
import { useAttune } from "@/contexts/attune.context";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceArea,
} from "recharts";

interface AttentionPoint {
  ts: number;
  score: number;
}

interface AppFocusPoint {
  ts: number;
  app_name: string;
  bundle_id: string;
  duration_sec: number;
}

interface DistractionPoint {
  ts: number;
  kind: string;
  severity: number;
  confidence: number;
  app_bundle_id?: string | null;
}

interface SessionTimeline {
  scores: AttentionPoint[];
  apps: AppFocusPoint[];
  distractions: DistractionPoint[];
}

interface SessionRow {
  id: string;
  summary_text?: string | null;
}

const DISTRACTION_COLORS: Record<string, string> = {
  attention_drift: "rgba(245, 158, 11, 0.15)",
  task_switching: "rgba(59, 130, 246, 0.15)",
  off_task_app: "rgba(239, 68, 68, 0.12)",
  physical_disruption: "rgba(168, 85, 247, 0.12)",
  emotional_overload: "rgba(34, 197, 94, 0.12)",
  false_hyperfocus: "rgba(236, 72, 153, 0.12)",
};

const DISTRACTION_LABELS: Record<string, string> = {
  attention_drift: "Attention drift",
  task_switching: "Task switching",
  off_task_app: "Off-task app",
  physical_disruption: "Away from screen",
  emotional_overload: "Emotional overload",
  false_hyperfocus: "Hyperfocus trap",
};

export function ParentSession() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const { isUnlocked } = useAttune();
  const [scores, setScores] = useState<AttentionPoint[]>([]);
  const [apps, setApps] = useState<AppFocusPoint[]>([]);
  const [distractions, setDistractions] = useState<DistractionPoint[]>([]);
  const [summary, setSummary] = useState<string | null>(null);

  useEffect(() => {
    if (!sessionId) return;
    invoke<SessionTimeline>("get_session_timeline", { sessionId }).then((timeline) => {
      setScores(timeline.scores);
      setApps(timeline.apps);
      setDistractions(timeline.distractions);
    });
    invoke<SessionRow[]>("list_sessions", { limit: 100 }).then((sessions) => {
      const match = sessions.find((x) => x.id === sessionId);
      if (match?.summary_text) setSummary(match.summary_text);
    });
  }, [sessionId]);

  if (!isUnlocked) return <Navigate to="/parent" replace />;

  const chartData = scores.map((s) => ({
    time: new Date(s.ts * 1000).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    }),
    score: Math.round(s.score),
  }));

  const distractionKinds = [...new Set(distractions.map((d) => d.kind))];

  const submitFeedback = async (kind: string, helpful: boolean) => {
    if (!sessionId) return;
    await invoke("submit_distraction_feedback", {
      sessionId,
      eventKind: kind,
      helpful,
    });
  };

  return (
    <div className="space-y-8 overflow-y-auto pb-8">
      <div>
        <h1 className="text-2xl font-semibold">Session Timeline</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Attention score, ML distraction patterns, and app focus segments.
        </p>
      </div>

      {chartData.length > 0 ? (
        <div className="h-64 w-full rounded-xl border border-border p-4">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData}>
              <XAxis dataKey="time" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
              <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} />
              <Tooltip />
              <ReferenceArea y1={0} y2={40} fill="rgba(239,68,68,0.08)" />
              <Line
                type="monotone"
                dataKey="score"
                stroke="rgb(245, 158, 11)"
                strokeWidth={2}
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <p className="text-muted-foreground text-sm">No timeline data for this session.</p>
      )}

      {distractions.length > 0 && (
        <div>
          <h2 className="text-lg font-medium mb-3">Distraction patterns</h2>
          <div className="flex flex-wrap gap-2 mb-4">
            {distractionKinds.map((kind) => (
              <span
                key={kind}
                className="text-xs px-2 py-1 rounded-full border border-border"
                style={{ backgroundColor: DISTRACTION_COLORS[kind] ?? "transparent" }}
              >
                {DISTRACTION_LABELS[kind] ?? kind}:{" "}
                {distractions.filter((d) => d.kind === kind).length}
              </span>
            ))}
          </div>
          <div className="space-y-2">
            {distractions.slice(0, 20).map((d, i) => (
              <div
                key={`${d.ts}-${d.kind}-${i}`}
                className="flex justify-between items-center text-sm rounded-lg border border-border px-4 py-2"
                style={{ backgroundColor: DISTRACTION_COLORS[d.kind] ?? "transparent" }}
              >
                <div>
                  <span className="font-medium">{DISTRACTION_LABELS[d.kind] ?? d.kind}</span>
                  {d.app_bundle_id && (
                    <span className="text-muted-foreground ml-2 text-xs">{d.app_bundle_id}</span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground text-xs">
                    {new Date(d.ts * 1000).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                  <button
                    type="button"
                    className="text-xs px-2 py-0.5 rounded border border-border hover:bg-muted"
                    onClick={() => submitFeedback(d.kind, true)}
                    title="This alert was helpful"
                  >
                    👍
                  </button>
                  <button
                    type="button"
                    className="text-xs px-2 py-0.5 rounded border border-border hover:bg-muted"
                    onClick={() => submitFeedback(d.kind, false)}
                    title="This alert was unnecessary"
                  >
                    👎
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {apps.length > 0 && (
        <div>
          <h2 className="text-lg font-medium mb-3">Apps used</h2>
          <div className="space-y-2">
            {apps.map((a, i) => (
              <div
                key={`${a.ts}-${i}`}
                className="flex justify-between text-sm rounded-lg border border-border px-4 py-2"
              >
                <span>{a.app_name}</span>
                <span className="text-muted-foreground">
                  {a.duration_sec}s ·{" "}
                  {new Date(a.ts * 1000).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {summary && (
        <div>
          <h2 className="text-lg font-medium mb-3">AI Summary</h2>
          <div className="rounded-xl border border-border p-4 text-sm leading-relaxed whitespace-pre-wrap">
            {summary}
          </div>
        </div>
      )}
    </div>
  );
}

import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useNavigate, Navigate } from "react-router-dom";
import { useAttune } from "@/contexts/attune.context";
import { Button } from "@/components/ui/button";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";

interface TrainingCompliance {
  date: string;
  minutes_played: number;
  minutes_remaining: number;
  daily_budget_minutes: number;
  missions_completed: number;
  locked_out: boolean;
  streak_days: number;
  missed_yesterday: boolean;
}

interface TrainingInsights {
  sessions_last_7_days: number;
  total_minutes_last_7_days: number;
  avg_steer_accuracy: number | null;
  avg_tap_accuracy: number | null;
  avg_multitask_cost: number | null;
  avg_gaze_engagement: number | null;
  trend_steer: number[];
  trend_tap: number[];
  trend_multitask: number[];
  trend_gaze: number[];
  recent_sessions: TrainingSessionSummary[];
}

interface TrainingSessionSummary {
  id: string;
  started_at: number;
  ended_at: number | null;
  mission_minutes: number;
  world_id: number;
  steer_accuracy: number | null;
  tap_accuracy: number | null;
  multitask_cost: number | null;
  gaze_engagement: number | null;
}

interface DifficultySeed {
  difficulty: {
    steer_speed: number;
    target_rate: number;
    distractor_ratio: number;
    rule_complexity: number;
  };
  seeded_from_screening: boolean;
  antisaccade_error_rate: number | null;
  vigilance_decay: number | null;
}

export function ParentTrain() {
  const { isUnlocked } = useAttune();
  const navigate = useNavigate();
  const [compliance, setCompliance] = useState<TrainingCompliance | null>(null);
  const [insights, setInsights] = useState<TrainingInsights | null>(null);
  const [seed, setSeed] = useState<DifficultySeed | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);

  useEffect(() => {
    if (!isUnlocked) return;
    Promise.all([
      invoke<TrainingCompliance>("get_training_compliance_cmd"),
      invoke<TrainingInsights>("get_training_insights_cmd"),
      invoke<DifficultySeed>("get_training_difficulty_seed"),
      invoke<string | null>("get_active_training"),
    ])
      .then(([c, i, s, active]) => {
        setCompliance(c);
        setInsights(i);
        setSeed(s);
        setActiveId(active);
      })
      .catch(console.error);
  }, [isUnlocked]);

  if (!isUnlocked) return <Navigate to="/parent" replace />;

  const trendData =
    insights?.trend_steer.map((_, idx) => ({
      session: idx + 1,
      steer: insights.trend_steer[idx] != null ? Math.round(insights.trend_steer[idx] * 100) : null,
      tap: insights.trend_tap[idx] != null ? Math.round(insights.trend_tap[idx] * 100) : null,
      gaze: insights.trend_gaze[idx] != null ? Math.round(insights.trend_gaze[idx] * 100) : null,
    })) ?? [];

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
        <h1 className="text-2xl font-semibold">Train</h1>
        <p className="text-muted-foreground text-sm mt-2 leading-relaxed">
          Adaptive attention exercises inspired by NeuroRacer research. Steer and tap
          multitasking missions adjust to your child&apos;s performance — like EndeavorRx-style
          training, built for macOS with webcam engagement tracking.
        </p>
      </div>

      <div className="rounded-xl border border-border p-4 text-sm leading-relaxed">
        <p className="font-medium">Training aid — not clinical care</p>
        <p className="text-muted-foreground mt-1">
          Train mode is an exercise program, not an FDA-authorized treatment. It does not
          diagnose ADHD or replace medication, therapy, or formal evaluation.
        </p>
      </div>

      {compliance?.missed_yesterday && !compliance.locked_out && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 text-sm">
          <p className="font-medium text-amber-900 dark:text-amber-200">Reminder</p>
          <p className="text-muted-foreground mt-1">
            Yesterday&apos;s training goal wasn&apos;t met. Regular practice (about{" "}
            {compliance.daily_budget_minutes} minutes/day, 5 days/week) works best.
          </p>
        </div>
      )}

      {compliance && (
        <div className="rounded-xl border border-border p-6 space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="font-medium">Today&apos;s mission minutes</p>
              <p className="text-3xl font-semibold mt-1 tabular-nums">
                {Math.round(compliance.minutes_remaining)}
                <span className="text-base font-normal text-muted-foreground">
                  {" "}
                  / {compliance.daily_budget_minutes} min left
                </span>
              </p>
              <p className="text-sm text-muted-foreground mt-1">
                {compliance.minutes_played.toFixed(1)} min played ·{" "}
                {compliance.missions_completed} mission
                {compliance.missions_completed !== 1 ? "s" : ""} ·{" "}
                {compliance.streak_days}-day streak
              </p>
            </div>
            <div>
              {activeId ? (
                <Button onClick={() => navigate("/parent/train/mission")}>
                  Resume mission
                </Button>
              ) : compliance.locked_out ? (
                <Button disabled>Daily budget complete</Button>
              ) : (
                <Button onClick={() => navigate("/parent/train/mission")}>
                  Start mission
                </Button>
              )}
            </div>
          </div>
        </div>
      )}

      {seed?.seeded_from_screening && (
        <div className="rounded-xl border border-border p-4 text-sm">
          <p className="font-medium">Personalized from screening</p>
          <p className="text-muted-foreground mt-1">
            Starting difficulty was adjusted using your child&apos;s last screening
            {seed.antisaccade_error_rate != null &&
              ` (antisaccade error rate ${Math.round(seed.antisaccade_error_rate * 100)}%)`}
            .
          </p>
        </div>
      )}

      {insights && insights.sessions_last_7_days > 0 && (
        <div className="space-y-4">
          <h2 className="text-lg font-medium">Last 7 days</h2>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-xl border border-border p-4">
              <p className="text-muted-foreground">Sessions</p>
              <p className="text-xl font-semibold">{insights.sessions_last_7_days}</p>
            </div>
            <div className="rounded-xl border border-border p-4">
              <p className="text-muted-foreground">Minutes</p>
              <p className="text-xl font-semibold">
                {insights.total_minutes_last_7_days.toFixed(0)}
              </p>
            </div>
            {insights.avg_steer_accuracy != null && (
              <div className="rounded-xl border border-border p-4">
                <p className="text-muted-foreground">Avg steer accuracy</p>
                <p className="text-xl font-semibold">
                  {Math.round(insights.avg_steer_accuracy * 100)}%
                </p>
              </div>
            )}
            {insights.avg_tap_accuracy != null && (
              <div className="rounded-xl border border-border p-4">
                <p className="text-muted-foreground">Avg tap accuracy</p>
                <p className="text-xl font-semibold">
                  {Math.round(insights.avg_tap_accuracy * 100)}%
                </p>
              </div>
            )}
            {insights.avg_multitask_cost != null && (
              <div className="rounded-xl border border-border p-4">
                <p className="text-muted-foreground">Avg multitask cost</p>
                <p className="text-xl font-semibold">
                  {Math.round(insights.avg_multitask_cost * 100)}%
                </p>
              </div>
            )}
            {insights.avg_gaze_engagement != null && (
              <div className="rounded-xl border border-border p-4">
                <p className="text-muted-foreground">Avg gaze engagement</p>
                <p className="text-xl font-semibold">
                  {Math.round(insights.avg_gaze_engagement * 100)}%
                </p>
              </div>
            )}
          </div>

          {trendData.length >= 2 && (
            <div className="rounded-xl border border-border p-4 h-56">
              <p className="text-sm font-medium mb-2">Accuracy trends</p>
              <ResponsiveContainer width="100%" height="90%">
                <LineChart data={trendData}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                  <XAxis dataKey="session" tick={{ fontSize: 11 }} />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Line type="monotone" dataKey="steer" stroke="#6366f1" dot={false} name="Steer %" />
                  <Line type="monotone" dataKey="tap" stroke="#22c55e" dot={false} name="Tap %" />
                  <Line type="monotone" dataKey="gaze" stroke="#f59e0b" dot={false} name="Gaze %" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      )}

      {insights && insights.recent_sessions.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-lg font-medium">Recent missions</h2>
          {insights.recent_sessions.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => navigate(`/parent/train/report/${s.id}`)}
              className="w-full text-left rounded-xl border border-border p-4 hover:bg-muted/50 transition-colors"
            >
              <div className="flex justify-between items-start">
                <div>
                  <p className="font-medium">{formatTime(s.started_at)}</p>
                  <p className="text-sm text-muted-foreground">
                    {s.mission_minutes.toFixed(1)} min · World {s.world_id}
                  </p>
                </div>
                {s.steer_accuracy != null && (
                  <span className="text-xs text-muted-foreground">
                    Steer {Math.round(s.steer_accuracy * 100)}% · Tap{" "}
                    {s.tap_accuracy != null ? Math.round(s.tap_accuracy * 100) : "—"}%
                  </span>
                )}
              </div>
            </button>
          ))}
        </div>
      )}

      <div className="rounded-xl border border-border p-4 text-sm text-muted-foreground">
        <p className="font-medium text-foreground">How it works</p>
        <ul className="mt-2 list-disc pl-5 space-y-1">
          <li>Warm up with steer-only, then tap-only, then both together</li>
          <li>Difficulty adapts every ~75 seconds to keep challenge at ~80% accuracy</li>
          <li>Webcam tracks gaze engagement during missions (on-device only)</li>
          <li>No win screen — consistent effort is what counts</li>
        </ul>
      </div>
    </div>
  );
}

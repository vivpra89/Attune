import { useState, useMemo } from "react";
import { Button, ScrollArea } from "@/components";
import {
  XIcon,
  TrendingUpIcon,
  CalendarIcon,
  ChevronRightIcon,
  TrashIcon,
  BarChart3Icon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type {
  InterviewCoachingSession,
  InterviewType,
  TargetCompany,
} from "./InterviewCoachingMode";

interface SessionHistoryPanelProps {
  onClose: () => void;
  onReviewSession: (session: InterviewCoachingSession) => void;
}

const TYPE_LABELS: Record<InterviewType, string> = {
  technical: "Technical",
  behavioral: "Behavioral",
  system_design: "System Design",
  coding: "Coding",
  product_management: "Product Mgmt",
  program_management: "Program Mgmt",
  general: "General",
};

const COMPANY_LABELS: Record<TargetCompany, string> = {
  amazon: "Amazon",
  google: "Google",
  meta: "Meta",
  apple: "Apple",
  netflix: "Netflix",
  microsoft: "Microsoft",
  generic: "Generic FAANG",
};

function loadSessions(): InterviewCoachingSession[] {
  try {
    const raw = localStorage.getItem("interview-coaching-sessions");
    if (!raw) return [];
    const sessions: InterviewCoachingSession[] = JSON.parse(raw);
    return sessions
      .filter((s) => s.overallScore > 0 && s.answers.length > 0)
      .sort((a, b) => b.createdAt - a.createdAt);
  } catch {
    return [];
  }
}

function deleteSingleSession(id: string) {
  try {
    const raw = localStorage.getItem("interview-coaching-sessions");
    if (!raw) return;
    const sessions: InterviewCoachingSession[] = JSON.parse(raw);
    const filtered = sessions.filter((s) => s.id !== id);
    localStorage.setItem(
      "interview-coaching-sessions",
      JSON.stringify(filtered)
    );
  } catch {
    /* ignore */
  }
}

function formatDate(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  const days = Math.floor(diff / 86400000);

  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function ScoreSparkline({ sessions }: { sessions: InterviewCoachingSession[] }) {
  const points = useMemo(() => {
    const sorted = [...sessions]
      .sort((a, b) => a.createdAt - b.createdAt)
      .slice(-20);
    if (sorted.length < 2) return null;

    const scores = sorted.map((s) => s.overallScore);
    const min = Math.min(...scores, 0);
    const max = Math.max(...scores, 100);
    const range = max - min || 1;
    const w = 200;
    const h = 48;
    const pad = 4;

    const pts = scores.map((score, i) => {
      const x = pad + (i / (scores.length - 1)) * (w - pad * 2);
      const y = h - pad - ((score - min) / range) * (h - pad * 2);
      return `${x},${y}`;
    });

    return { path: `M${pts.join(" L")}`, w, h, scores, avg: Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) };
  }, [sessions]);

  if (!points) return null;

  return (
    <div className="rounded-lg border border-border bg-muted/10 p-3">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5">
          <TrendingUpIcon className="w-3.5 h-3.5 text-primary" />
          <span className="text-xs font-medium">Score Trend</span>
        </div>
        <span className="text-xs text-muted-foreground">
          Avg: <span className="font-semibold text-foreground">{points.avg}</span>/100
        </span>
      </div>
      <svg
        viewBox={`0 0 ${points.w} ${points.h}`}
        className="w-full h-12"
        preserveAspectRatio="none"
      >
        <path
          d={points.path}
          fill="none"
          stroke="currentColor"
          className="text-primary"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <div className="flex justify-between text-[9px] text-muted-foreground mt-1">
        <span>{points.scores.length} sessions</span>
        <span>
          Latest: {points.scores[points.scores.length - 1]}
        </span>
      </div>
    </div>
  );
}

function CategoryBreakdown({ sessions }: { sessions: InterviewCoachingSession[] }) {
  const breakdown = useMemo(() => {
    const byCategory: Record<string, { total: number; count: number }> = {};
    for (const s of sessions) {
      for (const a of s.answers) {
        const q = s.questions.find((q) => q.id === a.questionId);
        const cat = q?.category || "Unknown";
        if (!byCategory[cat]) byCategory[cat] = { total: 0, count: 0 };
        byCategory[cat].total += a.coaching.score;
        byCategory[cat].count += 1;
      }
    }
    return Object.entries(byCategory)
      .map(([cat, { total, count }]) => ({
        category: cat,
        avg: Math.round(total / count),
        count,
      }))
      .sort((a, b) => a.avg - b.avg);
  }, [sessions]);

  if (breakdown.length === 0) return null;

  const weakest = breakdown.slice(0, 3).filter((b) => b.avg < 75);

  return (
    <div className="rounded-lg border border-border bg-muted/10 p-3 space-y-2">
      <div className="flex items-center gap-1.5">
        <BarChart3Icon className="w-3.5 h-3.5 text-primary" />
        <span className="text-xs font-medium">Category Performance</span>
      </div>
      <div className="space-y-1.5">
        {breakdown.slice(0, 6).map((b) => (
          <div key={b.category} className="flex items-center gap-2">
            <span className="text-[10px] text-muted-foreground w-24 truncate">
              {b.category}
            </span>
            <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
              <div
                className={cn(
                  "h-full rounded-full",
                  b.avg >= 75 && "bg-green-500",
                  b.avg >= 50 && b.avg < 75 && "bg-yellow-500",
                  b.avg < 50 && "bg-red-500"
                )}
                style={{ width: `${b.avg}%` }}
              />
            </div>
            <span className="text-[10px] font-medium tabular-nums w-8 text-right">
              {b.avg}
            </span>
          </div>
        ))}
      </div>
      {weakest.length > 0 && (
        <p className="text-[10px] text-amber-600 dark:text-amber-400 mt-1">
          Focus area: {weakest.map((w) => w.category).join(", ")}
        </p>
      )}
    </div>
  );
}

export function getWeakCategories(): { category: string; avg: number }[] {
  const sessions = loadSessions();
  if (sessions.length < 3) return [];

  const byCategory: Record<string, { total: number; count: number }> = {};
  for (const s of sessions) {
    for (const a of s.answers) {
      const q = s.questions.find((q) => q.id === a.questionId);
      const cat = q?.category || "Unknown";
      if (!byCategory[cat]) byCategory[cat] = { total: 0, count: 0 };
      byCategory[cat].total += a.coaching.score;
      byCategory[cat].count += 1;
    }
  }

  return Object.entries(byCategory)
    .map(([category, { total, count }]) => ({
      category,
      avg: Math.round(total / count),
    }))
    .filter((b) => b.avg < 70)
    .sort((a, b) => a.avg - b.avg)
    .slice(0, 3);
}

export const SessionHistoryPanel = ({
  onClose,
  onReviewSession,
}: SessionHistoryPanelProps) => {
  const [sessions, setSessions] = useState(loadSessions);

  const handleDelete = (id: string) => {
    deleteSingleSession(id);
    setSessions(loadSessions());
  };

  return (
    <div className="flex flex-col h-full bg-background">
      <div className="flex-shrink-0 border-b border-border/50 bg-gradient-to-r from-primary/5 to-primary/10 px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <CalendarIcon className="w-5 h-5 text-primary" />
            <h2 className="text-lg font-bold">Session History</h2>
            <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
              {sessions.length} session{sessions.length !== 1 ? "s" : ""}
            </span>
          </div>
          <Button size="sm" variant="ghost" onClick={onClose}>
            <XIcon className="w-4 h-4" />
          </Button>
        </div>
      </div>

      <ScrollArea className="flex-1 min-h-0">
        <div className="p-6 max-w-3xl mx-auto space-y-4">
          {sessions.length === 0 ? (
            <div className="text-center py-16 space-y-3">
              <CalendarIcon className="w-12 h-12 text-muted-foreground/30 mx-auto" />
              <p className="text-sm text-muted-foreground">
                No completed sessions yet. Start a practice interview to see
                your history here.
              </p>
            </div>
          ) : (
            <>
              <ScoreSparkline sessions={sessions} />
              <CategoryBreakdown sessions={sessions} />

              <div className="space-y-2">
                <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                  Past Sessions
                </h3>
                {sessions.map((session) => (
                  <button
                    key={session.id}
                    type="button"
                    onClick={() => onReviewSession(session)}
                    className="w-full text-left p-4 rounded-lg border border-border bg-background hover:bg-muted/20 transition-colors group"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0 space-y-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-medium">
                            {TYPE_LABELS[session.type]}
                          </span>
                          {session.targetCompany &&
                            session.targetCompany !== "generic" && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary font-medium">
                                {COMPANY_LABELS[session.targetCompany]}
                              </span>
                            )}
                          <span className="text-[10px] text-muted-foreground">
                            {formatDate(session.createdAt)}
                          </span>
                        </div>
                        <div className="flex items-center gap-3 text-xs text-muted-foreground">
                          <span>
                            {session.answers.length}/{session.questions.length}{" "}
                            questions
                          </span>
                          <span>
                            {
                              session.answers.filter(
                                (a) => a.coaching.score >= 80
                              ).length
                            }{" "}
                            strong
                          </span>
                          <span>
                            {
                              session.answers.filter(
                                (a) => a.coaching.score < 60
                              ).length
                            }{" "}
                            weak
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <div
                          className={cn(
                            "px-3 py-1.5 rounded-lg text-sm font-bold tabular-nums",
                            session.overallScore >= 80 &&
                              "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-400",
                            session.overallScore >= 60 &&
                              session.overallScore < 80 &&
                              "bg-yellow-100 text-yellow-700 dark:bg-yellow-950 dark:text-yellow-400",
                            session.overallScore < 60 &&
                              "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-400"
                          )}
                        >
                          {session.overallScore.toFixed(0)}
                        </div>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDelete(session.id);
                          }}
                          title="Delete session"
                        >
                          <TrashIcon className="w-3.5 h-3.5 text-muted-foreground" />
                        </Button>
                        <ChevronRightIcon className="w-4 h-4 text-muted-foreground" />
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </ScrollArea>
    </div>
  );
};

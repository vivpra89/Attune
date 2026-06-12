import type {
  InterviewPerformanceMetric,
  InterviewPerformanceSnapshot,
} from "@/hooks/useSystemAudio";
import { Button } from "@/components";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import {
  AudioLinesIcon,
  EyeIcon,
  EyeOffIcon,
  Loader2,
  ListIcon,
  SparklesIcon,
} from "lucide-react";
import { useMemo, useState } from "react";

function statusDotClass(status: InterviewPerformanceMetric["status"]) {
  switch (status) {
    case "good":
      return "bg-emerald-500";
    case "needs_work":
      return "bg-rose-500";
    default:
      return "bg-amber-500";
  }
}

type Props = {
  hasTranscript: boolean;
  snapshot: InterviewPerformanceSnapshot | null;
  loading: boolean;
  error: string;
  autoRefresh: boolean;
  onAutoRefreshChange: (enabled: boolean) => void;
  onCoachedAnswer?: (mode: "full" | "points") => void;
  coachActionDisabled?: boolean;
  className?: string;
};

export const InterviewPerformancePanel = ({
  hasTranscript,
  snapshot,
  loading,
  error,
  autoRefresh,
  onAutoRefreshChange,
  onCoachedAnswer,
  coachActionDisabled = false,
  className,
}: Props) => {
  const [detailsVisible, setDetailsVisible] = useState(true);
  const [showDraft, setShowDraft] = useState(false);

  const overall = snapshot?.overall ?? null;
  const label = snapshot?.overallLabel ?? "Expression";
  const metrics = snapshot?.metrics ?? [];
  const sourceHint =
    snapshot?.source === "heuristic"
      ? "Estimated from transcript"
      : snapshot?.source === "ai"
        ? "AI coaching read"
        : null;

  const r = 26;
  const c = 2 * Math.PI * r;
  const progress = overall != null ? Math.min(100, Math.max(0, overall)) / 100 : 0;
  const dashOffset = c * (1 - progress);

  const coach = useMemo(() => {
    if (!snapshot || snapshot.source !== "ai") return null;
    const focusQuestion = snapshot.focusQuestion?.trim() ?? "";
    const gaps = snapshot.gaps?.filter(Boolean) ?? [];
    const outline = snapshot.suggestedOutline?.filter(Boolean) ?? [];
    const draft = snapshot.optionalFullAnswer?.trim() ?? "";
    if (!focusQuestion && gaps.length === 0 && outline.length === 0 && !draft) {
      return null;
    }
    return { focusQuestion, gaps, outline, draft };
  }, [snapshot]);

  return (
    <div
      className={cn(
        "flex flex-col min-h-0 bg-background/95 @container/perf min-w-0",
        className
      )}
    >
      <div className="flex-shrink-0 flex items-center justify-between gap-2 px-2 py-1.5 border-b border-border/50">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-xs font-semibold truncate">Interview performance</span>
          <span
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary"
            title="Speech scoring"
          >
            <AudioLinesIcon className="h-3.5 w-3.5" strokeWidth={2.5} />
          </span>
          {loading && (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground shrink-0" />
          )}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <span className="text-[10px] text-muted-foreground">Auto</span>
          <Switch
            checked={autoRefresh}
            onCheckedChange={onAutoRefreshChange}
            className="scale-90 origin-right"
            title="Refresh scores periodically with your AI provider"
          />
          <Button
            type="button"
            size="icon"
            variant="outline"
            className="h-7 w-7"
            title={detailsVisible ? "Hide metric details" : "Show metric details"}
            onClick={() => setDetailsVisible((v) => !v)}
          >
            {detailsVisible ? (
              <EyeIcon className="h-3.5 w-3.5" />
            ) : (
              <EyeOffIcon className="h-3.5 w-3.5" />
            )}
          </Button>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-1.5 space-y-1.5">
        {!hasTranscript && (
          <p className="text-[10px] text-muted-foreground leading-relaxed">
            Scores appear once the system audio transcript has enough text.
            Metrics include delivery, clarity, and how well answers land — similar
            to speech coaching dashboards.
          </p>
        )}

        {error ? (
          <p className="text-[10px] text-rose-600 dark:text-rose-400">{error}</p>
        ) : null}

        {snapshot && (
          <div
            className={cn(
              "flex gap-1.5 items-start w-full",
              !detailsVisible && "flex-col items-center"
            )}
          >
            <div className="flex flex-col items-center shrink-0 w-[4.5rem]">
              <p className="text-[9px] font-medium text-muted-foreground mb-1 text-center leading-none px-0.5">
                {label}
              </p>
              <div className="relative h-[4.5rem] w-[4.5rem]">
                <svg
                  className="h-full w-full -rotate-90"
                  viewBox="0 0 100 100"
                  aria-hidden
                >
                  <circle
                    cx="50"
                    cy="50"
                    r={r}
                    fill="none"
                    className="stroke-muted/40"
                    strokeWidth="8"
                  />
                  <circle
                    cx="50"
                    cy="50"
                    r={r}
                    fill="none"
                    className="stroke-amber-500"
                    strokeWidth="8"
                    strokeLinecap="round"
                    strokeDasharray={c}
                    strokeDashoffset={dashOffset}
                  />
                </svg>
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <span className="text-base font-semibold tabular-nums text-foreground leading-none">
                    {overall}
                  </span>
                </div>
              </div>
              {sourceHint && (
                <p className="text-[8px] text-muted-foreground mt-1 text-center leading-tight px-0.5">
                  {sourceHint}
                </p>
              )}
            </div>

            {detailsVisible && metrics.length > 0 && (
              <div
                className={cn(
                  "min-w-0 flex-1 grid gap-2 pt-0.5",
                  metrics.length >= 2
                    ? "grid-cols-1 @md/perf:grid-cols-2"
                    : "grid-cols-1"
                )}
              >
                {metrics.map((m) => (
                  <div
                    key={m.key}
                    className="flex gap-1.5 items-center rounded-md border border-border/40 bg-muted/15 px-2 py-1 min-w-0"
                  >
                    <span
                      className={cn(
                        "h-1.5 w-1.5 rounded-full shrink-0",
                        statusDotClass(m.status)
                      )}
                      aria-hidden
                    />
                    <div className="min-w-0">
                      <p className="text-[10px] font-medium text-foreground leading-tight">
                        {m.label}
                        <span className="text-muted-foreground font-normal">
                          {" "}
                          · {m.score}
                        </span>
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {snapshot && coach && onCoachedAnswer && (
          <div className="rounded border border-primary/20 bg-primary/5 p-1.5 space-y-1.5">
            <p className="text-[10px] font-semibold text-foreground">
              Suggested direction
            </p>
            {coach.focusQuestion ? (
              <div>
                <p className="text-[9px] font-medium text-muted-foreground uppercase tracking-wide">
                  Focus question
                </p>
                <p className="text-[11px] text-foreground leading-snug mt-0.5">
                  {coach.focusQuestion}
                </p>
              </div>
            ) : null}
            {(coach.gaps.length > 0 || coach.outline.length > 0) && (
              <div
                className={cn(
                  "grid gap-2 min-w-0",
                  coach.gaps.length > 0 && coach.outline.length > 0
                    ? "grid-cols-1 @md/perf:grid-cols-2 @md/perf:gap-x-3"
                    : "grid-cols-1"
                )}
              >
                {coach.gaps.length > 0 ? (
                  <div className="min-w-0">
                    <p className="text-[9px] font-medium text-muted-foreground uppercase tracking-wide">
                      Gaps to fix
                    </p>
                    <ul className="mt-0.5 space-y-0.5 list-disc pl-3.5">
                      {coach.gaps.map((g, i) => (
                        <li
                          key={`${i}-${g.slice(0, 24)}`}
                          className="text-[10px] text-foreground/90 leading-snug"
                        >
                          {g}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {coach.outline.length > 0 ? (
                  <div className="min-w-0">
                    <p className="text-[9px] font-medium text-muted-foreground uppercase tracking-wide">
                      Outline
                    </p>
                    <ol className="mt-0.5 space-y-0.5 list-decimal pl-3.5">
                      {coach.outline.map((o, i) => (
                        <li
                          key={`${i}-${o.slice(0, 24)}`}
                          className="text-[10px] text-foreground/90 leading-snug"
                        >
                          {o}
                        </li>
                      ))}
                    </ol>
                  </div>
                ) : null}
              </div>
            )}
            {coach.draft ? (
              <div>
                <button
                  type="button"
                  onClick={() => setShowDraft((v) => !v)}
                  className="text-[9px] font-medium text-primary hover:underline"
                >
                  {showDraft ? "Hide" : "Show"} coach draft
                </button>
                {showDraft ? (
                  <p className="text-[10px] text-muted-foreground leading-snug mt-1 whitespace-pre-wrap">
                    {coach.draft}
                  </p>
                ) : null}
              </div>
            ) : null}
            <div className="flex flex-col gap-1.5 pt-0.5">
              <Button
                type="button"
                size="sm"
                variant="default"
                className="h-8 text-[10px] gap-1.5 w-full justify-center"
                disabled={coachActionDisabled}
                onClick={() => onCoachedAnswer("full")}
              >
                <SparklesIcon className="h-3.5 w-3.5 shrink-0" />
                Generate speaking answer
              </Button>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                className="h-8 text-[10px] gap-1.5 w-full justify-center"
                disabled={coachActionDisabled}
                onClick={() => onCoachedAnswer("points")}
              >
                <ListIcon className="h-3.5 w-3.5 shrink-0" />
                Quick talking points
              </Button>
            </div>
          </div>
        )}

        {hasTranscript && !snapshot && !loading && !error && (
          <p className="text-[10px] text-muted-foreground">
            Keep speaking — scores will show after a few more words.
          </p>
        )}
      </div>
    </div>
  );
};

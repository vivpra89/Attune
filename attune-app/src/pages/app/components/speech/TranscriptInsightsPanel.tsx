import type { TranscriptInsight } from "@/hooks/useSystemAudio";
import { Button } from "@/components";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { ChevronDownIcon, Lightbulb, Loader2 } from "lucide-react";
import { useMemo, useState } from "react";

type Props = {
  hasTranscript: boolean;
  autoTranscriptInsights: boolean;
  onAutoChange: (enabled: boolean) => void;
  insight: TranscriptInsight | null;
  loading: boolean;
  error: string;
  onAnswerQuestion: (question: string) => void;
  answerDisabled: boolean;
};

export const TranscriptInsightsPanel = ({
  hasTranscript,
  autoTranscriptInsights,
  onAutoChange,
  insight,
  loading,
  error,
  onAnswerQuestion,
  answerDisabled,
}: Props) => {
  const [insightsOpen, setInsightsOpen] = useState(true);

  const questionCount = insight?.questions?.length ?? 0;

  const collapsedPreview = useMemo(() => {
    if (!insight) return "";
    const s = insight.summary?.trim();
    if (s) return s.length > 140 ? `${s.slice(0, 137)}…` : s;
    if (insight.questions[0])
      return insight.questions[0].length > 140
        ? `${insight.questions[0].slice(0, 137)}…`
        : insight.questions[0];
    return "";
  }, [insight]);

  return (
    <div
      className={cn(
        "rounded-lg border border-border/50 bg-muted/15 p-2 space-y-2",
        !hasTranscript && !autoTranscriptInsights && "opacity-80"
      )}
    >
      <div className="flex items-center justify-between gap-2 px-0.5">
        <div className="flex items-center gap-2 min-w-0">
          <Lightbulb className="h-4 w-4 text-amber-500/90 shrink-0" />
          <span className="text-xs font-semibold truncate">Live insights</span>
          {loading && (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground shrink-0" />
          )}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <span className="text-xs text-muted-foreground">Auto</span>
          <Switch
            checked={autoTranscriptInsights}
            onCheckedChange={onAutoChange}
            className="scale-90 origin-right"
          />
        </div>
      </div>

      <details
        className="rounded-md border border-border/40 bg-muted/10 overflow-hidden"
        open={insightsOpen}
        onToggle={(e) => setInsightsOpen(e.currentTarget.open)}
      >
        <summary className="cursor-pointer select-none list-none px-2 py-1.5 hover:bg-muted/25 [&::-webkit-details-marker]:hidden">
          <div className="flex items-start gap-2">
            <ChevronDownIcon
              className={cn(
                "h-3.5 w-3.5 shrink-0 mt-0.5 text-muted-foreground transition-transform",
                insightsOpen && "rotate-180"
              )}
            />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                <span className="text-xs font-medium text-foreground/85">
                  Summary & questions
                </span>
                {questionCount > 0 && (
                  <span className="text-[10px] text-muted-foreground bg-muted/50 px-1.5 py-px rounded">
                    {questionCount} question{questionCount !== 1 ? "s" : ""}
                  </span>
                )}
                {autoTranscriptInsights && loading && (
                  <span className="text-[10px] text-muted-foreground">
                    Updating…
                  </span>
                )}
              </div>
              {!insightsOpen && (
                <p className="text-xs text-muted-foreground leading-snug mt-1 line-clamp-2">
                  {!hasTranscript
                    ? "Start capture for background summary and detected questions."
                    : collapsedPreview ||
                      (autoTranscriptInsights
                        ? "Waiting for transcript…"
                        : "Turn Auto on to generate insights.")}
                </p>
              )}
            </div>
          </div>
        </summary>

        <div className="border-t border-border/30 px-2 pb-2 pt-2 space-y-2.5">
          {!hasTranscript && (
            <p className="text-xs text-muted-foreground leading-snug">
              Start capture to summarize the transcript and surface questions in
              the background.
            </p>
          )}

          {error && (
            <p className="text-xs text-amber-800 dark:text-amber-200/90">
              {error}
            </p>
          )}

          {autoTranscriptInsights && hasTranscript && insight?.summary && (
            <p className="text-sm text-muted-foreground leading-relaxed border-l-2 border-primary/25 pl-2.5">
              {insight.summary}
            </p>
          )}

          {autoTranscriptInsights &&
            hasTranscript &&
            insight &&
            insight.questions.length > 0 && (
              <ul className="space-y-2">
                {insight.questions.map((q, i) => (
                  <li
                    key={`${i}-${q.slice(0, 24)}`}
                    className="flex items-start gap-2 text-sm leading-snug"
                  >
                    <span className="text-muted-foreground shrink-0 pt-0.5 font-medium">
                      {i + 1}.
                    </span>
                    <span className="flex-1 min-w-0">{q}</span>
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      className="h-7 px-2 text-xs shrink-0"
                      disabled={answerDisabled}
                      onClick={(e) => {
                        e.stopPropagation();
                        onAnswerQuestion(q);
                      }}
                    >
                      Answer
                    </Button>
                  </li>
                ))}
              </ul>
            )}
        </div>
      </details>
    </div>
  );
};

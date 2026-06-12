import { TranscriptEntry } from "@/hooks/useSystemAudio";
import { Switch } from "@/components/ui/switch";
import {
  ChevronDownIcon,
  Loader2,
  MessageSquareTextIcon,
} from "lucide-react";
import { useEffect, useRef, useState, useMemo } from "react";
import { cn } from "@/lib/utils";

const QUESTION_STARTS =
  /^(what|how|why|when|where|who|which|can|could|would|should|do|does|did|is|are|was|were|have|has|had|tell|describe|explain|walk)\b/i;

function looksLikeQuestion(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.endsWith("?")) return true;
  return QUESTION_STARTS.test(trimmed);
}

type Props = {
  isAIProcessing: boolean;
  isProcessing: boolean;
  transcriptEntries: TranscriptEntry[];
  lastAnsweredIndex: number;
  autoTranscriptRollup: boolean;
  onAutoRollupChange: (enabled: boolean) => void;
  transcriptRollupSummary: string;
  transcriptRollupThroughIndex: number;
  rollupLoading: boolean;
};

export const ResultsSection = ({
  isAIProcessing: _isAIProcessing,
  isProcessing,
  transcriptEntries,
  lastAnsweredIndex,
  autoTranscriptRollup,
  onAutoRollupChange,
  transcriptRollupSummary,
  transcriptRollupThroughIndex,
  rollupLoading,
}: Props) => {
  const hasTranscript = transcriptEntries.length > 0;
  const scrollRef = useRef<HTMLDivElement>(null);
  const rollupCursorRef = useRef(transcriptRollupThroughIndex);
  const [liveTranscriptOpen, setLiveTranscriptOpen] = useState(true);

  const visibleEntries = transcriptEntries.slice(transcriptRollupThroughIndex);
  const summarizedCount = transcriptRollupThroughIndex;

  const verbatimPreview = useMemo(() => {
    const t = visibleEntries
      .map((e) => e.text)
      .join(" ")
      .trim();
    if (t.length <= 100) return t;
    return `…${t.slice(-96)}`;
  }, [visibleEntries]);

  useEffect(() => {
    const prev = rollupCursorRef.current;
    rollupCursorRef.current = transcriptRollupThroughIndex;
    if (
      transcriptRollupThroughIndex > prev &&
      transcriptRollupSummary.trim()
    ) {
      setLiveTranscriptOpen(false);
    }
  }, [transcriptRollupThroughIndex, transcriptRollupSummary]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [
    transcriptEntries.length,
    transcriptRollupThroughIndex,
  ]);

  return (
    <div className="rounded border border-border/50 bg-muted/20 p-1.5 space-y-1.5">
      {/* Transcript */}
      <div className="space-y-1.5">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <div className="flex items-center gap-1.5">
            <MessageSquareTextIcon className="w-3.5 h-3.5 text-primary" />
            <h4 className="text-xs font-medium">Transcript</h4>
          </div>
          {hasTranscript && (
            <span className="text-[9px] text-muted-foreground bg-muted/50 px-1.5 py-0.5 rounded-full">
              {summarizedCount > 0 ? (
                <>
                  {visibleEntries.length} recent
                  <span className="text-muted-foreground/70">
                    {" "}
                    · {summarizedCount} summarized
                  </span>
                </>
              ) : (
                <>
                  {transcriptEntries.length} segment
                  {transcriptEntries.length !== 1 ? "s" : ""}
                </>
              )}
            </span>
          )}
          <div className="flex items-center gap-1 ml-auto">
            <span className="text-[9px] text-muted-foreground whitespace-nowrap">
              1 min rollup
            </span>
            <Switch
              checked={autoTranscriptRollup}
              onCheckedChange={onAutoRollupChange}
              className="scale-75 origin-right"
            />
            {rollupLoading && (
              <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
            )}
          </div>
        </div>

        {transcriptRollupSummary.trim() && (
          <details className="rounded-md border border-border/40 bg-muted/30 px-2 py-1.5 text-[9px] text-muted-foreground leading-relaxed">
            <summary className="cursor-pointer font-medium text-foreground/80 select-none">
              Earlier discussion (rolled-up)
            </summary>
            <p className="mt-1.5 whitespace-pre-wrap">{transcriptRollupSummary}</p>
          </details>
        )}

        {hasTranscript && (
          <details
            className="rounded-md border border-border/40 bg-muted/15 overflow-hidden"
            open={liveTranscriptOpen}
            onToggle={(e) =>
              setLiveTranscriptOpen(e.currentTarget.open)
            }
          >
            <summary className="cursor-pointer select-none list-none px-2 py-1.5 hover:bg-muted/25 [&::-webkit-details-marker]:hidden">
              <div className="flex items-start gap-2">
                <ChevronDownIcon
                  className={cn(
                    "h-3.5 w-3.5 shrink-0 mt-0.5 text-muted-foreground transition-transform",
                    liveTranscriptOpen && "rotate-180"
                  )}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    <span className="text-[9px] font-medium text-foreground/85">
                      Live transcript (verbatim)
                    </span>
                    <span className="text-[8px] text-muted-foreground bg-muted/50 px-1 py-px rounded">
                      {visibleEntries.length} segment
                      {visibleEntries.length !== 1 ? "s" : ""}
                    </span>
                  </div>
                  {!liveTranscriptOpen && verbatimPreview && (
                    <p className="text-[8px] text-muted-foreground leading-snug mt-1 line-clamp-2">
                      {verbatimPreview}
                    </p>
                  )}
                </div>
              </div>
            </summary>
            <div
              ref={scrollRef}
              className="max-h-32 overflow-y-auto px-2 pb-2 pt-0 border-t border-border/30"
            >
              <div className="text-[12px] leading-relaxed text-foreground/90 pr-1">
                {visibleEntries.map((entry, i) => {
                  const globalIdx = transcriptRollupThroughIndex + i;
                  const isQuestion = looksLikeQuestion(entry.text);
                  const isAnswered = globalIdx < lastAnsweredIndex;
                  const isBoundary =
                    globalIdx === lastAnsweredIndex && lastAnsweredIndex > 0;

                  return (
                    <span key={entry.id}>
                      {isBoundary && (
                        <span className="flex items-center gap-1 my-1.5">
                          <span className="flex-1 h-px bg-primary/30" />
                          <span className="text-[8px] text-primary/60 font-medium px-1">
                            answered above
                          </span>
                          <span className="flex-1 h-px bg-primary/30" />
                        </span>
                      )}
                      {i > 0 && !isBoundary && " "}
                      <span
                        className={cn(
                          "rounded px-0.5 transition-colors",
                          isQuestion && !isAnswered &&
                            "bg-amber-100/60 dark:bg-amber-900/30 border-b border-amber-400/50",
                          isQuestion && isAnswered &&
                            "bg-muted/30",
                          !isQuestion && isAnswered &&
                            "text-muted-foreground/70",
                          !isQuestion && !isAnswered &&
                            "hover:bg-muted/50"
                        )}
                      >
                        {entry.text}
                      </span>
                    </span>
                  );
                })}
                {isProcessing && (
                  <span className="inline-flex items-center gap-1 ml-1 text-muted-foreground">
                    <Loader2 className="h-2.5 w-2.5 animate-spin" />
                  </span>
                )}
              </div>
            </div>
          </details>
        )}

        {!hasTranscript && isProcessing && (
          <div className="flex items-center justify-center gap-2 py-4">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            <span className="text-xs text-muted-foreground">
              Waiting for speech...
            </span>
          </div>
        )}

        {!hasTranscript && !isProcessing && (
          <p className="text-[10px] text-muted-foreground text-center py-3">
            Transcript will appear here as audio is captured.
          </p>
        )}
      </div>
    </div>
  );
};

import { Markdown, CopyButton } from "@/components";
import { Switch } from "@/components/ui/switch";
import { BotIcon, Loader2 } from "lucide-react";
import { ConciseAnswer } from "./ConciseAnswer";

type Props = {
  lastAIResponse: string;
  isAIProcessing: boolean;
  conciseMode: boolean;
  onConciseModeChange: (enabled: boolean) => void;
};

export const AIAnswerPanel = ({
  lastAIResponse,
  isAIProcessing,
  conciseMode,
  onConciseModeChange,
}: Props) => {
  const hasResponse = lastAIResponse || isAIProcessing;

  if (!hasResponse) return null;

  return (
    <div className="rounded border border-border/50 bg-muted/20 p-1.5">
      <div className="rounded bg-background/50 p-1.5">
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-1.5">
            <BotIcon className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
              AI Answer
            </span>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1">
              <span className="text-[9px] text-muted-foreground whitespace-nowrap">
                Concise
              </span>
              <Switch
                checked={conciseMode}
                onCheckedChange={onConciseModeChange}
                className="scale-75 origin-right"
              />
            </div>
            {lastAIResponse && <CopyButton content={lastAIResponse} />}
          </div>
        </div>
        {isAIProcessing && !lastAIResponse ? (
          <div className="flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            <span className="text-xs text-muted-foreground">
              Generating answer...
            </span>
          </div>
        ) : (
          <>
            {conciseMode ? (
              <ConciseAnswer content={lastAIResponse} />
            ) : (
              <div className="prose prose-base max-w-none dark:prose-invert text-base leading-relaxed">
                <Markdown>{lastAIResponse}</Markdown>
              </div>
            )}
            {isAIProcessing && (
              <span className="inline-block w-2 h-4 bg-primary animate-pulse ml-1 align-middle" />
            )}
          </>
        )}
      </div>
    </div>
  );
};

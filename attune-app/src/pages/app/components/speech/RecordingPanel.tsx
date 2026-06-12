import {
  Loader2,
  AudioWaveformIcon,
  CheckCircle2Icon,
  AlertCircleIcon,
  RadioIcon,
  PauseCircleIcon,
  PlayCircleIcon,
  SquareIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components";

type CaptureStatus =
  | "idle"
  | "starting"
  | "active"
  | "speech"
  | "transcribing"
  | "error";

interface RecordingPanelProps {
  isVadMode: boolean;
  isProcessing: boolean;
  isAIProcessing: boolean;
  recordingProgress: number;
  captureStatus: CaptureStatus;
  speechSegmentCount: number;
  chunkSecs: number;
  onChunkSecsChange: (secs: number) => void;
  paused: boolean;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
}

const STATUS_CONFIG: Record<
  CaptureStatus,
  { label: string; color: string }
> = {
  idle: { label: "Idle", color: "text-muted-foreground" },
  starting: { label: "Starting...", color: "text-yellow-500" },
  active: { label: "Streaming", color: "text-green-500" },
  speech: { label: "Speech detected", color: "text-blue-500" },
  transcribing: { label: "Transcribing...", color: "text-purple-500" },
  error: { label: "Error", color: "text-red-500" },
};

function formatTime(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

const CHUNK_OPTIONS = [2, 3, 5, 10];

export const RecordingPanel = ({
  isVadMode,
  isProcessing,
  isAIProcessing,
  recordingProgress,
  captureStatus,
  speechSegmentCount,
  chunkSecs,
  onChunkSecsChange,
  paused,
  onPause,
  onResume,
  onStop,
}: RecordingPanelProps) => {
  const isWorking = isProcessing || isAIProcessing;
  const status = STATUS_CONFIG[captureStatus];

  if (isVadMode) {
    return (
      <div className="rounded border border-border/50 bg-muted/30 overflow-hidden">
        <div className="px-1.5 py-1 space-y-0.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {captureStatus === "active" || captureStatus === "speech" ? (
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
                </span>
              ) : captureStatus === "transcribing" ? (
                <Loader2 className="w-3 h-3 animate-spin text-purple-500" />
              ) : captureStatus === "error" ? (
                <AlertCircleIcon className="w-3 h-3 text-red-500" />
              ) : captureStatus === "starting" ? (
                <Loader2 className="w-3 h-3 animate-spin text-yellow-500" />
              ) : (
                <span className="w-2 h-2 rounded-full bg-muted-foreground" />
              )}
              <span className={cn("text-[10px] font-medium", status.color)}>
                {status.label}
              </span>
            </div>

            <div className="flex items-center gap-2">
              {speechSegmentCount > 0 && (
                <div className="flex items-center gap-1">
                  <CheckCircle2Icon className="w-3 h-3 text-green-500" />
                  <span className="text-[9px] text-muted-foreground">
                    {speechSegmentCount} segment
                    {speechSegmentCount !== 1 ? "s" : ""}
                  </span>
                </div>
              )}

              {isWorking && (
                <div className="flex items-center gap-1">
                  <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />
                  <span className="text-[9px] text-muted-foreground">
                    {isProcessing ? "Transcribing..." : "Generating..."}
                  </span>
                </div>
              )}

              {!isWorking && captureStatus === "active" && (
                <AudioWaveformIcon className="w-3 h-3 text-green-500 animate-pulse" />
              )}

              <Button
                size="sm"
                variant="ghost"
                className="h-6 px-1.5 gap-1 text-red-600 hover:text-red-700 hover:bg-red-50"
                title="Stop and end session"
                onClick={onStop}
              >
                <SquareIcon className="w-3.5 h-3.5" />
                <span className="text-[9px]">Stop</span>
              </Button>
            </div>
          </div>

          <div className="flex gap-1">
            <PipelineDot
              active={captureStatus !== "idle"}
              label="Capture"
              filled={
                captureStatus !== "idle" && captureStatus !== "starting"
              }
            />
            <div className="flex-1 h-px bg-border/50 self-center" />
            <PipelineDot
              active={
                captureStatus === "speech" ||
                captureStatus === "transcribing"
              }
              label="VAD"
              filled={speechSegmentCount > 0}
            />
            <div className="flex-1 h-px bg-border/50 self-center" />
            <PipelineDot
              active={captureStatus === "transcribing"}
              label="STT"
              filled={false}
            />
          </div>
        </div>
      </div>
    );
  }

  // Streaming mode
  return (
    <div className="rounded border border-border/50 bg-muted/30 overflow-hidden">
      <div className="px-1.5 py-1 space-y-0.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {paused ? (
              <span className="w-2 h-2 rounded-full bg-amber-500" />
            ) : captureStatus === "active" || captureStatus === "transcribing" ? (
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
              </span>
            ) : captureStatus === "starting" ? (
              <Loader2 className="w-3 h-3 animate-spin text-yellow-500" />
            ) : captureStatus === "error" ? (
              <AlertCircleIcon className="w-3 h-3 text-red-500" />
            ) : (
              <span className="w-2 h-2 rounded-full bg-muted-foreground" />
            )}
            <span className={cn("text-[10px] font-medium", paused ? "text-amber-500" : status.color)}>
              {paused
                ? "Paused"
                : captureStatus === "active" || captureStatus === "transcribing"
                  ? "Streaming"
                  : status.label}
            </span>
            {recordingProgress > 0 && (
              <span className="text-[10px] text-muted-foreground tabular-nums">
                {formatTime(recordingProgress)}
              </span>
            )}
            
            {/* Chunk interval selector - inline */}
            {!paused && (
              <div className="flex items-center gap-1 ml-2">
                <span className="text-[9px] text-muted-foreground">Interval:</span>
                {CHUNK_OPTIONS.map((s) => (
                  <button
                    key={s}
                    onClick={() => onChunkSecsChange(s)}
                    className={cn(
                      "px-1.5 py-0.5 rounded text-[9px] font-medium transition-colors",
                      chunkSecs === s
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted hover:bg-muted/80 text-muted-foreground"
                    )}
                  >
                    {s}s
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="flex items-center gap-2">
            {speechSegmentCount > 0 && (
              <div className="flex items-center gap-1">
                <RadioIcon className="w-3 h-3 text-green-500" />
                <span className="text-[9px] text-muted-foreground">
                  {speechSegmentCount} chunk
                  {speechSegmentCount !== 1 ? "s" : ""}
                </span>
              </div>
            )}

            {isWorking && (
              <div className="flex items-center gap-1">
                <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />
                <span className="text-[9px] text-muted-foreground">
                  {isAIProcessing ? "Answering..." : "Transcribing..."}
                </span>
              </div>
            )}

            <Button
              size="sm"
              variant="ghost"
              className="h-6 px-1.5 gap-1"
              title={paused ? "Resume transcription" : "Pause transcription"}
              onClick={paused ? onResume : onPause}
            >
              {paused ? (
                <PlayCircleIcon className="w-3.5 h-3.5 text-green-500" />
              ) : (
                <PauseCircleIcon className="w-3.5 h-3.5 text-amber-500" />
              )}
              <span className="text-[9px]">{paused ? "Resume" : "Pause"}</span>
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-6 px-1.5 gap-1 text-red-600 hover:text-red-700 hover:bg-red-50"
              title="Stop and end session"
              onClick={onStop}
            >
              <SquareIcon className="w-3.5 h-3.5" />
              <span className="text-[9px]">Stop</span>
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};

function PipelineDot({
  active,
  label,
  filled,
}: {
  active: boolean;
  label: string;
  filled: boolean;
}) {
  return (
    <div className="flex flex-col items-center gap-0.5">
      <div
        className={cn(
          "w-1.5 h-1.5 rounded-full transition-colors",
          filled
            ? "bg-green-500"
            : active
              ? "bg-yellow-400 animate-pulse"
              : "bg-muted-foreground/30"
        )}
      />
      <span className="text-[7px] text-muted-foreground">{label}</span>
    </div>
  );
}

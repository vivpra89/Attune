import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import type { FeedbackUpdate } from "@/contexts/attune.context";

type FeedbackCuePayload =
  | string
  | {
      cue: string;
      volume: number;
    };

const CUE_FILES = ["nudge", "dim", "reengage"] as const;

function resolveCue(payload: FeedbackCuePayload): { file: string; volume: number; rate: number } | null {
  const cue = typeof payload === "string" ? payload : payload.cue;
  const volume =
    typeof payload === "string"
      ? cue === "nudge"
        ? 0.35
        : 0.45
      : payload.volume;

  if (cue === "break") {
    return { file: "dim", volume, rate: 0.75 };
  }
  if (cue === "nudge" || cue === "dim" || cue === "reengage") {
    return { file: cue, volume, rate: 1 };
  }
  return null;
}

function usePreloadedCues() {
  const refs = useRef<Record<string, HTMLAudioElement>>({});

  useEffect(() => {
    for (const name of CUE_FILES) {
      const audio = new Audio(`/sounds/${name}.wav`);
      audio.preload = "auto";
      refs.current[name] = audio;
    }
  }, []);

  return useCallback((payload: FeedbackCuePayload) => {
    const resolved = resolveCue(payload);
    if (!resolved) return;

    const template = refs.current[resolved.file];
    if (!template) return;

    const audio = new Audio(template.src);
    audio.volume = resolved.volume;
    audio.playbackRate = resolved.rate;
    audio.play().catch(() => {});
  }, []);
}

export function AttentionDimOverlay() {
  const [opacity, setOpacity] = useState(0);
  const [childMessage, setChildMessage] = useState("");
  const [showReengage, setShowReengage] = useState(false);
  const [showBreak, setShowBreak] = useState(false);
  const [showConfusion, setShowConfusion] = useState(false);
  const [feedbackState, setFeedbackState] = useState<string>("focused");
  const [primaryDistraction, setPrimaryDistraction] = useState<string | null>(null);
  const prevOpacityRef = useRef(0);
  const playCue = usePreloadedCues();

  useEffect(() => {
    const unlistenOpacity = listen<number>("dim-opacity-changed", (event) => {
      setOpacity(event.payload);
    });
    const unlistenFeedback = listen<FeedbackUpdate>("feedback-update", (event) => {
      const p = event.payload;
      setChildMessage(p.child_message);
      setFeedbackState(p.state);
      setShowBreak(p.show_break_prompt);
      setShowConfusion(p.show_confusion_help);
      setPrimaryDistraction(p.primary_distraction ?? null);
      if (p.show_reengage) {
        setShowReengage(true);
        window.setTimeout(() => setShowReengage(false), 1200);
      }
    });
    const unlistenCue = listen<FeedbackCuePayload>("play-feedback-cue", (event) => {
      playCue(event.payload);
    });
    return () => {
      unlistenOpacity.then((fn) => fn());
      unlistenFeedback.then((fn) => fn());
      unlistenCue.then((fn) => fn());
    };
  }, [playCue]);

  const isSoftNudge = feedbackState === "soft_nudge" || feedbackState === "confusion_help";
  const isDimmed = feedbackState === "dimmed" || feedbackState === "break_suggest";
  const isFocused = feedbackState === "focused";
  const fadingOut = opacity < prevOpacityRef.current - 0.01;
  prevOpacityRef.current = opacity;

  const overlayTint = showReengage
    ? "rgba(20, 60, 40, 0.35)"
    : isSoftNudge
      ? "rgba(40, 35, 25, 0.65)"
      : "rgba(15, 10, 5, 0.92)";

  const fullDim = isDimmed && opacity >= 0.85;

  const displayOpacity =
    showReengage && isFocused
      ? Math.min(0.35, opacity + 0.15)
      : isFocused
        ? opacity
        : opacity;

  const showVisuals = displayOpacity > 0.03 && (!isFocused || showReengage);
  const transitionMs = fadingOut || isFocused ? 300 : 700;
  const faceAbsentBreak = primaryDistraction === "physical_disruption";

  return (
    <div
      className="fixed inset-0 w-screen h-screen overflow-hidden pointer-events-none"
      style={{
        opacity: displayOpacity,
        transition: `opacity ${transitionMs}ms ease-out`,
      }}
    >
      <div
        className={`absolute inset-0 ${
          fullDim ? "backdrop-blur-xl" : isDimmed ? "backdrop-blur-md" : isSoftNudge ? "backdrop-blur-sm" : ""
        }`}
        style={{
          backgroundColor: overlayTint,
          opacity: 1,
          transition: `background-color ${transitionMs}ms ease-out`,
        }}
      />

      {showReengage && (
        <div className="absolute inset-0 pointer-events-none ring-4 ring-emerald-400/50 ring-inset animate-pulse" />
      )}

      {showVisuals && (!isFocused || showReengage) && (
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 flex flex-col items-center gap-5 pointer-events-none max-w-md px-4">
          {showReengage ? (
            <div className="relative flex items-center justify-center size-24">
              <div
                className="absolute inset-0 rounded-full border-2 border-emerald-400/70 animate-pulse"
                style={{ boxShadow: "0 0 32px rgba(52, 211, 153, 0.5)" }}
              />
              <div className="rounded-full bg-emerald-400 size-4" />
            </div>
          ) : (
            feedbackState !== "focused" && (
              <div
                className={`relative flex items-center justify-center ${
                  isSoftNudge ? "size-24" : "size-32"
                }`}
              >
                <div
                  className={`absolute inset-0 rounded-full border-2 animate-pulse ${
                    isSoftNudge ? "border-amber-300/50" : "border-amber-400/70"
                  }`}
                  style={{
                    boxShadow: isSoftNudge
                      ? "0 0 28px rgba(251, 191, 36, 0.35)"
                      : "0 0 40px rgba(251, 191, 36, 0.55)",
                  }}
                />
                <div
                  className={`rounded-full bg-amber-300/90 ${
                    isSoftNudge ? "size-3" : "size-4"
                  }`}
                />
              </div>
            )
          )}

          {(childMessage || showBreak || showConfusion) && (
            <div className="w-full px-6 py-4 rounded-2xl bg-black/50 backdrop-blur-md border border-white/15 text-center shadow-2xl">
              <p className="text-white/95 text-sm font-medium leading-relaxed">{childMessage}</p>
              {(showBreak || (isDimmed && fullDim)) && (
                <p className="text-white/70 text-xs mt-2">
                  {faceAbsentBreak
                    ? "Still here when you're ready — the dim will fade on its own"
                    : "Look back at your lesson — the screen clears when you're focused again"}
                </p>
              )}
              {showConfusion && (
                <p className="text-amber-200/90 text-xs mt-2">It&apos;s okay to pause and re-read</p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default AttentionDimOverlay;

/** Play a cue for settings preview (not tied to session scheduler). */
export function previewFeedbackCue(
  cue: "nudge" | "dim" | "reengage",
  volumeMultiplier: number
) {
  const base = cue === "nudge" ? 0.3 : cue === "dim" ? 0.4 : 0.28;
  const audio = new Audio(`/sounds/${cue}.wav`);
  audio.volume = Math.min(0.55, base * volumeMultiplier);
  audio.play().catch(() => {});
}

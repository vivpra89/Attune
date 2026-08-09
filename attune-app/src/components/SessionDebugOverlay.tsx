import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { DebugLogEntry, SessionDebugTick } from "@/types/debug";

const THROTTLE_MS = 500;
const MAX_LOG_ENTRIES = 100;

const FEEDBACK_COLORS: Record<string, string> = {
  focused: "text-emerald-400",
  soft_nudge: "text-amber-400",
  dimmed: "text-orange-400",
  break_suggest: "text-sky-400",
  confusion_help: "text-violet-400",
  hyperfocus_redirect: "text-rose-400",
};

function fmt(v: number, digits = 2) {
  return v.toFixed(digits);
}

function shortId(id: string) {
  return id.slice(0, 8);
}

function Section({
  title,
  open,
  onToggle,
  children,
}: {
  title: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="border-b border-white/10">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center justify-between px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-white/70 hover:bg-white/5"
      >
        {title}
        <span className="text-white/40">{open ? "−" : "+"}</span>
      </button>
      {open && <div className="px-3 pb-2 space-y-0.5">{children}</div>}
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-2 text-[11px] font-mono">
      <span className="text-white/50 shrink-0">{label}</span>
      <span className="text-white/90 text-right truncate">{value}</span>
    </div>
  );
}

function buildTransitionLogs(
  prev: SessionDebugTick | null,
  tick: SessionDebugTick,
  nextId: number
): DebugLogEntry[] {
  const entries: DebugLogEntry[] = [];
  let id = nextId;

  if (prev && prev.feedback.state !== tick.feedback.state) {
    entries.push({
      id: id++,
      ts: tick.ts,
      message: `Feedback: ${prev.feedback.state} → ${tick.feedback.state} (opacity ${fmt(tick.feedback.opacity)})`,
    });
  }

  if (prev && prev.app_bundle !== tick.app_bundle && tick.app_bundle) {
    entries.push({
      id: id++,
      ts: tick.ts,
      message: `App switch: ${tick.app_name ?? tick.app_bundle}`,
    });
  }

  if (prev && prev.distraction.primary !== tick.distraction.primary && tick.distraction.primary) {
    entries.push({
      id: id++,
      ts: tick.ts,
      message: `Distraction primary: ${tick.distraction.primary}`,
    });
  }

  if (prev) {
    const prevActive = new Set(prev.distraction.active);
    for (const kind of tick.distraction.active) {
      if (!prevActive.has(kind)) {
        entries.push({
          id: id++,
          ts: tick.ts,
          message: `Distraction active: ${kind}`,
        });
      }
    }
    for (const kind of prev.distraction.active) {
      if (!tick.distraction.active.includes(kind)) {
        entries.push({
          id: id++,
          ts: tick.ts,
          message: `Distraction cleared: ${kind}`,
        });
      }
    }
  }

  if (prev && prev.feedback.opacity !== tick.feedback.opacity) {
    const delta = tick.feedback.opacity - prev.feedback.opacity;
    if (Math.abs(delta) >= 0.05) {
      entries.push({
        id: id++,
        ts: tick.ts,
        message: `Opacity: ${fmt(prev.feedback.opacity)} → ${fmt(tick.feedback.opacity)}`,
      });
    }
  }

  return entries;
}

export function SessionDebugOverlay() {
  const [tick, setTick] = useState<SessionDebugTick | null>(null);
  const [logs, setLogs] = useState<DebugLogEntry[]>([]);
  const [sections, setSections] = useState({
    session: true,
    vision: true,
    app: true,
    distraction: true,
    feedback: true,
    log: true,
  });
  const [copied, setCopied] = useState(false);

  const pendingTick = useRef<SessionDebugTick | null>(null);
  const prevTick = useRef<SessionDebugTick | null>(null);
  const sessionStartTs = useRef<number | null>(null);
  const logId = useRef(0);
  const logEndRef = useRef<HTMLDivElement>(null);
  const logContainerRef = useRef<HTMLDivElement>(null);
  const userScrolledUp = useRef(false);

  const flushTick = useCallback(() => {
    const next = pendingTick.current;
    if (!next) return;

    const newLogs = buildTransitionLogs(prevTick.current, next, logId.current);
    if (newLogs.length > 0) {
      logId.current += newLogs.length;
      setLogs((prev) => [...prev, ...newLogs].slice(-MAX_LOG_ENTRIES));
    }

    prevTick.current = next;
    if (sessionStartTs.current === null) {
      sessionStartTs.current = next.ts;
    }
    setTick(next);
    pendingTick.current = null;
  }, []);

  useEffect(() => {
    const interval = setInterval(flushTick, THROTTLE_MS);
    return () => clearInterval(interval);
  }, [flushTick]);

  useEffect(() => {
    const unlistenTick = listen<SessionDebugTick>("session-debug-tick", (event) => {
      pendingTick.current = event.payload;
    });
    const unlistenCue = listen<{ cue: string; volume: number }>("feedback-cue-logged", (event) => {
      const { cue, volume } = event.payload;
      const entry: DebugLogEntry = {
        id: logId.current++,
        ts: Math.floor(Date.now() / 1000),
        message: `Audio cue: ${cue} (vol ${(volume * 100).toFixed(0)}%)`,
      };
      setLogs((prev) => [...prev, entry].slice(-MAX_LOG_ENTRIES));
    });
    return () => {
      unlistenTick.then((fn) => fn());
      unlistenCue.then((fn) => fn());
    };
  }, []);

  useEffect(() => {
    if (userScrolledUp.current) return;
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  const toggleSection = (key: keyof typeof sections) => {
    setSections((s) => ({ ...s, [key]: !s[key] }));
  };

  const onLogScroll = () => {
    const el = logContainerRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
    userScrolledUp.current = !atBottom;
  };

  const copyJson = async () => {
    if (!tick) return;
    await navigator.clipboard.writeText(JSON.stringify(tick, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const startDrag = async (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest("button")) return;
    await getCurrentWindow().startDragging();
  };

  const elapsed =
    tick && sessionStartTs.current != null
      ? Math.max(0, tick.ts - sessionStartTs.current)
      : null;

  const feedbackColor = tick
    ? (FEEDBACK_COLORS[tick.feedback.state] ?? "text-white")
    : "text-white";

  return (
    <div className="w-screen h-screen bg-transparent p-0 overflow-hidden">
      <div className="flex flex-col h-full bg-black/85 backdrop-blur-md border border-white/10 rounded-lg text-white font-sans overflow-hidden">
        <div
          className="flex items-center justify-between px-3 py-2 border-b border-white/10 cursor-grab active:cursor-grabbing shrink-0"
          onMouseDown={startDrag}
        >
          <div>
            <p className="text-xs font-semibold">Attune Debug</p>
            <p className="text-[10px] text-white/40">Session pipeline monitor</p>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={copyJson}
              disabled={!tick}
              className="text-[10px] px-2 py-1 rounded bg-white/10 hover:bg-white/20 disabled:opacity-40"
            >
              {copied ? "Copied" : "Copy JSON"}
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto min-h-0">
          {!tick ? (
            <p className="p-4 text-xs text-white/50 text-center">
              Waiting for session ticks…
            </p>
          ) : (
            <>
              <Section
                title="Session"
                open={sections.session}
                onToggle={() => toggleSection("session")}
              >
                <Row label="id" value={shortId(tick.session_id)} />
                <Row label="elapsed" value={elapsed != null ? `${elapsed}s` : "—"} />
                <Row label="model" value={tick.vision.model_version} />
              </Section>

              <Section
                title="Vision"
                open={sections.vision}
                onToggle={() => toggleSection("vision")}
              >
                <Row label="face" value={tick.vision.face_present ? "yes" : "no"} />
                <Row
                  label="face_missing"
                  value={
                    tick.vision.face_present
                      ? "—"
                      : `${tick.feedback.face_missing_secs.toFixed(1)}s`
                  }
                />
                <Row label="score" value={fmt(tick.vision.score, 0)} />
                <Row label="quality" value={fmt(tick.vision.face_quality)} />
                <Row label="eyes" value={fmt(tick.vision.eye_openness)} />
                <Row label="head_pen" value={fmt(tick.vision.head_pose_penalty)} />
                <Row
                  label="pose"
                  value={`y${fmt(tick.vision.yaw, 0)} p${fmt(tick.vision.pitch, 0)}`}
                />
                <Row
                  label="emotion"
                  value={`${tick.vision.emotion} (${fmt(tick.vision.emotion_confidence)})`}
                />
                <Row label="engagement" value={fmt(tick.vision.engagement_prob)} />
                <Row label="gaze_away" value={fmt(tick.vision.gaze_away_prob)} />
                <Row
                  label="probs"
                  value={`E${fmt(tick.vision.prob_engaged, 1)} B${fmt(tick.vision.prob_bored, 1)} C${fmt(tick.vision.prob_confused, 1)} F${fmt(tick.vision.prob_frustrated, 1)} N${fmt(tick.vision.prob_neutral, 1)}`}
                />
              </Section>

              <Section
                title="App focus"
                open={sections.app}
                onToggle={() => toggleSection("app")}
              >
                <Row label="app" value={tick.app_name ?? "—"} />
                <Row label="bundle" value={tick.app_bundle ?? "—"} />
                <Row
                  label="dwell"
                  value={`${fmt(tick.distraction.current_app_dwell_secs, 1)}s`}
                />
                <Row
                  label="switches/60s"
                  value={String(tick.distraction.task_switch_count_60s)}
                />
              </Section>

              <Section
                title="Distraction"
                open={sections.distraction}
                onToggle={() => toggleSection("distraction")}
              >
                <Row label="primary" value={tick.distraction.primary ?? "—"} />
                <Row
                  label="active"
                  value={
                    tick.distraction.active.length > 0
                      ? tick.distraction.active.join(", ")
                      : "—"
                  }
                />
                {tick.distraction.events.slice(-3).map((ev, i) => (
                  <Row
                    key={`${ev.kind}-${ev.ts}-${i}`}
                    label={ev.kind}
                    value={`${fmt(ev.severity)} / ${fmt(ev.confidence)}`}
                  />
                ))}
              </Section>

              <Section
                title="Feedback"
                open={sections.feedback}
                onToggle={() => toggleSection("feedback")}
              >
                <Row
                  label="state"
                  value={
                    <span className={feedbackColor}>{tick.feedback.state}</span>
                  }
                />
                <Row label="opacity" value={fmt(tick.feedback.opacity)} />
                <Row
                  label="drift"
                  value={
                    tick.distraction.active.includes("attention_drift")
                      ? "active"
                      : "—"
                  }
                />
                <Row label="smoothed" value={fmt(tick.feedback.smoothed_score, 0)} />
                <Row label="effective" value={fmt(tick.feedback.effective_score, 0)} />
                <Row label="message" value={tick.feedback.child_message} />
                <Row
                  label="flags"
                  value={[
                    tick.feedback.show_reengage && "reengage",
                    tick.feedback.show_break_prompt && "break",
                    tick.feedback.show_confusion_help && "confusion",
                  ]
                    .filter(Boolean)
                    .join(", ") || "—"}
                />
              </Section>

              <Section
                title="Event log"
                open={sections.log}
                onToggle={() => toggleSection("log")}
              >
                <div
                  ref={logContainerRef}
                  onScroll={onLogScroll}
                  className="max-h-32 overflow-y-auto space-y-0.5"
                >
                  {logs.length === 0 ? (
                    <p className="text-[10px] text-white/40">No transitions yet</p>
                  ) : (
                    logs.map((entry) => (
                      <div
                        key={entry.id}
                        className="text-[10px] font-mono text-white/70 leading-tight"
                      >
                        <span className="text-white/30">
                          {new Date(entry.ts * 1000).toLocaleTimeString()}
                        </span>{" "}
                        {entry.message}
                      </div>
                    ))
                  )}
                  <div ref={logEndRef} />
                </div>
              </Section>
            </>
          )}
        </div>

        <div className="px-3 py-1.5 border-t border-white/10 text-[10px] text-white/30 shrink-0">
          Debug mode — development only
        </div>
      </div>
    </div>
  );
}

export default SessionDebugOverlay;

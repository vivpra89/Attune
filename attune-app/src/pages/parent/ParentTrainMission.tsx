import { useEffect, useRef, useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useNavigate, Navigate } from "react-router-dom";
import { useAttune } from "@/contexts/attune.context";
import { Button } from "@/components/ui/button";
import {
  TrainGameEngine,
  ruleForComplexity,
  WORLD_THEMES,
  MICRO_RUN_SECS,
  STEER_WARMUP_SECS,
  TAP_WARMUP_SECS,
  INTRO_SECS,
  DEFAULT_MISSION_MINUTES,
  type DifficultyState,
  type GamePhase,
} from "@/config/trainGame";

interface TrainingSessionStart {
  session_id: string;
  difficulty: DifficultyState;
  world_id: number;
  minutes_remaining_today: number;
  locked_out: boolean;
}

interface TrainingRunResult {
  run_index: number;
  difficulty: DifficultyState;
}

interface TrainingSessionReport {
  session_id: string;
  mission_minutes: number;
}

export function ParentTrainMission() {
  const { isUnlocked } = useAttune();
  const navigate = useNavigate();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<TrainGameEngine | null>(null);
  const rafRef = useRef<number>(0);
  const phaseRef = useRef<GamePhase>("intro");
  const phaseStartRef = useRef(0);
  const missionStartRef = useRef(0);
  const lastRunSubmitRef = useRef(0);
  const sessionIdRef = useRef<string | null>(null);
  const pausedRef = useRef(false);

  const [phase, setPhase] = useState<GamePhase>("intro");
  const [worldId, setWorldId] = useState(1);
  const [paused, setPaused] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [ruleLabel, setRuleLabel] = useState("");
  const [timeLeft, setTimeLeft] = useState(DEFAULT_MISSION_MINUTES * 60);

  const missionDurationSecs =
    DEFAULT_MISSION_MINUTES * 60 - INTRO_SECS - STEER_WARMUP_SECS - TAP_WARMUP_SECS;

  const submitRun = useCallback(async (currentPhase: GamePhase) => {
    const engine = engineRef.current;
    if (!engine || !sessionIdRef.current) return;
    const metrics = engine.computeRunMetrics(currentPhase);
    try {
      const result = await invoke<TrainingRunResult>("record_training_run", {
        metrics,
      });
      engine.setDifficulty(result.difficulty);
      setRuleLabel(ruleForComplexity(result.difficulty.rule_complexity).label);
    } catch (e) {
      console.error(e);
    }
  }, []);

  const finishMission = useCallback(async () => {
    const engine = engineRef.current;
    if (!engine || !sessionIdRef.current) return;
    cancelAnimationFrame(rafRef.current);

    const acc = engine.sessionAccuracy();
    const elapsedMin =
      (performance.now() - missionStartRef.current) / 1000 / 60;

    try {
      const report = await invoke<TrainingSessionReport>("end_training_session", {
        missionMinutes: elapsedMin,
        steerAccuracy: acc.steer,
        tapAccuracy: acc.tap,
        multitaskCost: acc.multitask,
        meanRtMs: acc.meanRt,
      });
      navigate(`/parent/train/report/${report.session_id}`);
    } catch (e) {
      setError(String(e));
    }
  }, [navigate]);

  const advancePhase = useCallback(
    (now: number) => {
      const elapsed = (now - phaseStartRef.current) / 1000;
      const current = phaseRef.current;

      if (current === "intro" && elapsed >= INTRO_SECS) {
        phaseRef.current = "steer";
        setPhase("steer");
        phaseStartRef.current = now;
        lastRunSubmitRef.current = now;
        engineRef.current?.startRunSnapshot();
        return;
      }
      if (current === "steer" && elapsed >= STEER_WARMUP_SECS) {
        void submitRun("steer");
        phaseRef.current = "tap";
        setPhase("tap");
        phaseStartRef.current = now;
        lastRunSubmitRef.current = now;
        engineRef.current?.startRunSnapshot();
        return;
      }
      if (current === "tap" && elapsed >= TAP_WARMUP_SECS) {
        void submitRun("tap");
        phaseRef.current = "multitask";
        setPhase("multitask");
        phaseStartRef.current = now;
        lastRunSubmitRef.current = now;
        engineRef.current?.startRunSnapshot();
        return;
      }
    },
    [submitRun]
  );

  useEffect(() => {
    if (!isUnlocked) return;

    invoke<TrainingSessionStart>("start_training_session")
      .then((start) => {
        sessionIdRef.current = start.session_id;
        setWorldId(start.world_id);
        const rule = ruleForComplexity(start.difficulty.rule_complexity);
        setRuleLabel(rule.label);
        engineRef.current = new TrainGameEngine(start.difficulty, start.difficulty.rule_complexity);
        missionStartRef.current = performance.now();
        phaseStartRef.current = performance.now();
        lastRunSubmitRef.current = performance.now();
        setLoading(false);
      })
      .catch((e) => {
        setError(String(e));
        setLoading(false);
      });

    return () => {
      cancelAnimationFrame(rafRef.current);
    };
  }, [isUnlocked]);

  useEffect(() => {
    if (loading || error || !engineRef.current) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "a" || e.key === "A" || e.key === "ArrowLeft") {
        engineRef.current?.setSteerKey("left", true);
      }
      if (e.key === "d" || e.key === "D" || e.key === "ArrowRight") {
        engineRef.current?.setSteerKey("right", true);
      }
      if (e.key === " " || e.key === "Enter") {
        e.preventDefault();
        const engine = engineRef.current;
        if (engine && (phaseRef.current === "tap" || phaseRef.current === "multitask")) {
          const ok = engine.tapTarget(performance.now() / 1000);
          void invoke("record_training_event", {
            eventType: ok ? "tap_correct" : "tap_incorrect",
            correct: ok,
            rtMs: null,
          }).catch(console.error);
        }
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === "a" || e.key === "A" || e.key === "ArrowLeft") {
        engineRef.current?.setSteerKey("left", false);
      }
      if (e.key === "d" || e.key === "D" || e.key === "ArrowRight") {
        engineRef.current?.setSteerKey("right", false);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);

    const loop = (ts: number) => {
      if (pausedRef.current) {
        rafRef.current = requestAnimationFrame(loop);
        return;
      }

      const canvas = canvasRef.current;
      const engine = engineRef.current;
      if (!canvas || !engine) return;

      const now = ts / 1000;
      const missionElapsed = (ts - missionStartRef.current) / 1000;
      const totalMissionSecs =
        INTRO_SECS + STEER_WARMUP_SECS + TAP_WARMUP_SECS + missionDurationSecs;
      setTimeLeft(Math.max(0, Math.ceil(totalMissionSecs - missionElapsed)));

      if (missionElapsed >= totalMissionSecs) {
        void submitRun(phaseRef.current === "multitask" ? "multitask" : phaseRef.current);
        void finishMission();
        return;
      }

      advancePhase(ts);

      if (
        phaseRef.current !== "intro" &&
        now - lastRunSubmitRef.current >= MICRO_RUN_SECS
      ) {
        void submitRun(phaseRef.current);
        engine.startRunSnapshot();
        lastRunSubmitRef.current = now;
      }

      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      if (canvas.width !== rect.width * dpr || canvas.height !== rect.height * dpr) {
        canvas.width = rect.width * dpr;
        canvas.height = rect.height * dpr;
      }

      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      engine.update(
        1 / 60,
        phaseRef.current,
        rect.width,
        rect.height,
        now
      );

      const theme = WORLD_THEMES[worldId] ?? WORLD_THEMES[1];
      engine.draw(ctx, rect.width, rect.height, phaseRef.current, theme, ruleForComplexity(engine.difficulty.rule_complexity));

      rafRef.current = requestAnimationFrame(loop);
    };

    rafRef.current = requestAnimationFrame(loop);

    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      cancelAnimationFrame(rafRef.current);
    };
  }, [loading, error, worldId, advancePhase, submitRun, finishMission, missionDurationSecs]);

  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  if (!isUnlocked) return <Navigate to="/parent" replace />;

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <p className="text-muted-foreground">Starting mission…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-4 max-w-lg mx-auto mt-12">
        <p className="text-destructive">{error}</p>
        <Button onClick={() => navigate("/parent/train")}>Back to Train</Button>
      </div>
    );
  }

  const theme = WORLD_THEMES[worldId] ?? WORLD_THEMES[1];
  const phaseLabel =
    phase === "intro"
      ? "Get ready"
      : phase === "steer"
        ? "Steer only — use A / D"
        : phase === "tap"
          ? "Tap only — Space bar"
          : "Multitask — steer and tap";

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black">
      <div className="flex items-center justify-between px-4 py-2 bg-black/60 text-white text-sm">
        <span>{phaseLabel}</span>
        <span>{Math.floor(timeLeft / 60)}:{String(timeLeft % 60).padStart(2, "0")}</span>
        <Button
          variant="ghost"
          size="sm"
          className="text-white hover:bg-white/10"
          onClick={() => setPaused((p) => !p)}
        >
          {paused ? "Resume" : "Pause"}
        </Button>
      </div>

      {phase === "intro" && (
        <div className="absolute inset-0 flex items-center justify-center z-10 pointer-events-none">
          <div className="rounded-xl bg-black/70 text-white p-8 max-w-md text-center space-y-3">
            <p className="text-lg font-medium">Mission briefing</p>
            <p className="text-sm opacity-90">{ruleLabel}</p>
            <p className="text-xs opacity-70">
              Steer with A/D · Tap with Space · There is no winning — keep trying your best
            </p>
          </div>
        </div>
      )}

      <canvas
        ref={canvasRef}
        className="flex-1 w-full cursor-crosshair"
        style={{ background: theme.sky }}
        onClick={() => {
          const engine = engineRef.current;
          if (engine && (phase === "tap" || phase === "multitask")) {
            const ok = engine.tapTarget(performance.now() / 1000);
            void invoke("record_training_event", {
              eventType: ok ? "tap_correct" : "tap_incorrect",
              correct: ok,
              rtMs: null,
            }).catch(console.error);
          }
        }}
      />

      <div className="px-4 py-2 bg-black/60 text-white/70 text-xs text-center">
        Training aid — not a diagnosis or replacement for clinical care
      </div>
    </div>
  );
}

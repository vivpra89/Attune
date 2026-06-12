import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  STORY_MANIFEST,
  type StoryProbe,
  type StoryScene,
} from "@/config/storyAttentionManifest";

interface StoryAttentionPlayerProps {
  onComplete: () => void;
  recordProbe: (probeIndex: number, cueSide: "left" | "right") => Promise<void>;
}

const THEME_STYLES: Record<
  string,
  { sky: string; ground: string; accent: string; detail: string }
> = {
  meadow: {
    sky: "from-sky-300 to-sky-100",
    ground: "bg-emerald-400",
    accent: "bg-yellow-300",
    detail: "text-emerald-700",
  },
  forest: {
    sky: "from-slate-400 to-slate-200",
    ground: "bg-emerald-700",
    accent: "bg-emerald-900",
    detail: "text-emerald-950",
  },
  pond: {
    sky: "from-blue-300 to-cyan-100",
    ground: "bg-teal-500",
    accent: "bg-blue-400",
    detail: "text-teal-900",
  },
  sunset: {
    sky: "from-orange-400 to-amber-200",
    ground: "bg-orange-600",
    accent: "bg-purple-400",
    detail: "text-orange-900",
  },
};

function Character({
  gaze,
  probeActive,
}: {
  gaze: "center" | "left" | "right";
  probeActive: boolean;
}) {
  const eyeOffset =
    gaze === "left" ? "-translate-x-1" : gaze === "right" ? "translate-x-1" : "";

  return (
    <div
      className={`absolute bottom-[28%] left-1/2 -translate-x-1/2 transition-transform duration-500 ${
        probeActive ? "scale-105" : ""
      }`}
      aria-hidden
    >
      <div className="relative">
        <div className="size-16 rounded-full bg-amber-200 border-4 border-amber-300 shadow-md" />
        <div
          className={`absolute top-5 left-1/2 -translate-x-1/2 flex gap-3 transition-transform duration-300 ${eyeOffset}`}
        >
          <div className="size-2.5 rounded-full bg-slate-800" />
          <div className="size-2.5 rounded-full bg-slate-800" />
        </div>
        <div className="absolute top-10 left-1/2 -translate-x-1/2 w-4 h-2 border-b-2 border-slate-700 rounded-b-full" />
        {probeActive && (
          <div
            className={`absolute top-4 size-3 rounded-full bg-primary animate-pulse ${
              gaze === "left"
                ? "-left-6"
                : gaze === "right"
                  ? "-right-6"
                  : "left-1/2 -translate-x-1/2 -top-2"
            }`}
          />
        )}
      </div>
    </div>
  );
}

function SceneBackdrop({ scene, characterGaze }: { scene: StoryScene; characterGaze: "center" | "left" | "right" }) {
  const style = THEME_STYLES[scene.theme] ?? THEME_STYLES.meadow;
  const probeActive = characterGaze !== "center";

  return (
    <div className={`absolute inset-0 bg-gradient-to-b ${style.sky}`}>
      <div className={`absolute bottom-0 left-0 right-0 h-[35%] ${style.ground}`} />
      {scene.theme === "meadow" && (
        <>
          <div className={`absolute top-[18%] right-[20%] size-14 rounded-full ${style.accent} opacity-80`} />
          <div className="absolute bottom-[38%] left-[15%] text-4xl opacity-60">🌸</div>
          <div className="absolute bottom-[42%] right-[22%] text-3xl opacity-60">🦋</div>
        </>
      )}
      {scene.theme === "forest" && (
        <>
          <div className={`absolute bottom-[32%] left-[10%] w-8 h-24 ${style.accent} rounded-t-full`} />
          <div className={`absolute bottom-[32%] right-[12%] w-10 h-28 ${style.accent} rounded-t-full`} />
          <div className={`absolute bottom-[36%] left-[30%] text-2xl ${style.detail}`}>🐿️</div>
        </>
      )}
      {scene.theme === "pond" && (
        <>
          <div className={`absolute bottom-[30%] left-[20%] right-[20%] h-8 ${style.accent} rounded-full opacity-70`} />
          <div className="absolute bottom-[38%] right-[18%] text-3xl">🐸</div>
          <div className="absolute bottom-[45%] left-[18%] text-2xl">🪷</div>
        </>
      )}
      {scene.theme === "sunset" && (
        <>
          <div className={`absolute top-[15%] left-1/2 -translate-x-1/2 size-20 rounded-full ${style.accent} opacity-60`} />
          <div className="absolute bottom-[40%] left-[12%] text-3xl">⭐</div>
          <div className="absolute bottom-[44%] right-[15%] text-2xl">🌙</div>
        </>
      )}
      <Character gaze={characterGaze} probeActive={probeActive} />
    </div>
  );
}

function activeScene(elapsedSec: number): StoryScene {
  const scenes = STORY_MANIFEST.scenes;
  for (let i = scenes.length - 1; i >= 0; i--) {
    if (elapsedSec >= scenes[i].start_sec) return scenes[i];
  }
  return scenes[0];
}

function characterGazeAt(
  elapsedSec: number,
  activeProbe: StoryProbe | null,
): "center" | "left" | "right" {
  if (activeProbe && elapsedSec >= activeProbe.at_sec && elapsedSec < activeProbe.at_sec + 2.5) {
    return activeProbe.cue_side;
  }
  return "center";
}

export function StoryAttentionPlayer({ onComplete, recordProbe }: StoryAttentionPlayerProps) {
  const [elapsedSec, setElapsedSec] = useState(0);
  const [fadeKey, setFadeKey] = useState(0);
  const recordedProbesRef = useRef(new Set<number>());
  const prevSceneRef = useRef<string>("");
  const startTsRef = useRef<number | null>(null);

  useEffect(() => {
    startTsRef.current = performance.now();
    const interval = setInterval(() => {
      const start = startTsRef.current ?? performance.now();
      const elapsed = (performance.now() - start) / 1000;
      setElapsedSec(elapsed);
      if (elapsed >= STORY_MANIFEST.duration_sec) {
        clearInterval(interval);
        onComplete();
      }
    }, 100);
    return () => clearInterval(interval);
  }, [onComplete]);

  const scene = activeScene(elapsedSec);
  const activeProbe =
    STORY_MANIFEST.probes.find(
      (p) => elapsedSec >= p.at_sec && elapsedSec < p.at_sec + 0.15,
    ) ?? null;

  useEffect(() => {
    if (!activeProbe) return;
    if (recordedProbesRef.current.has(activeProbe.probe_index)) return;
    recordedProbesRef.current.add(activeProbe.probe_index);
    void recordProbe(activeProbe.probe_index, activeProbe.cue_side);
  }, [activeProbe, recordProbe]);

  useEffect(() => {
    if (scene.id !== prevSceneRef.current) {
      prevSceneRef.current = scene.id;
      setFadeKey((k) => k + 1);
    }
  }, [scene.id]);

  const gaze = characterGazeAt(
    elapsedSec,
    STORY_MANIFEST.probes.find(
      (p) => elapsedSec >= p.at_sec && elapsedSec < p.at_sec + 2.5,
    ) ?? null,
  );

  const remaining = Math.max(0, Math.ceil(STORY_MANIFEST.duration_sec - elapsedSec));

  return (
    <div className="relative flex-1 overflow-hidden bg-muted/30">
      <div
        key={fadeKey}
        className="absolute inset-0 animate-in fade-in duration-700"
      >
        <SceneBackdrop scene={scene} characterGaze={gaze} />
      </div>
      <div className="absolute top-4 right-4 text-xs text-muted-foreground tabular-nums bg-background/60 px-2 py-1 rounded">
        {remaining}s
      </div>
    </div>
  );
}

export async function beginNaturalisticPhase(): Promise<void> {
  await invoke("set_screening_task", { taskId: "naturalistic_viewing" });
}

export async function recordStoryProbe(
  probeIndex: number,
  cueSide: "left" | "right",
): Promise<void> {
  const cueOnsetTs = await invoke<number>("get_screening_timestamp");
  await invoke("record_screening_trial", {
    taskId: "story_probe",
    trialIndex: probeIndex,
    cueSide,
    cueOnsetTs,
  });
}

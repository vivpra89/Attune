export interface DifficultyState {
  steer_speed: number;
  target_rate: number;
  distractor_ratio: number;
  rule_complexity: number;
}

export type GamePhase = "intro" | "steer" | "tap" | "multitask" | "done";

export interface RunMetrics {
  phase: string;
  steer_accuracy: number;
  tap_accuracy: number;
  multitask_cost: number;
  mean_rt_ms: number;
  gaze_engagement: number;
  steer_attempts: number;
  tap_attempts: number;
}

export interface TargetRule {
  label: string;
  color: string;
  shape: "circle" | "square";
}

const COLORS = [
  { name: "blue", hex: "#3b82f6" },
  { name: "red", hex: "#ef4444" },
  { name: "green", hex: "#22c55e" },
];

const SHAPES = ["circle", "square"] as const;

export function ruleForComplexity(complexity: number): TargetRule {
  if (complexity >= 3) {
    return { label: "Tap only blue circles", color: "blue", shape: "circle" };
  }
  if (complexity >= 2) {
    return { label: "Tap only blue targets", color: "blue", shape: "circle" };
  }
  return { label: "Tap only blue targets", color: "blue", shape: "circle" };
}

export interface Gate {
  x: number;
  y: number;
  width: number;
  gapX: number;
  gapWidth: number;
  passed: boolean;
  hit: boolean;
}

export interface Target {
  id: number;
  x: number;
  y: number;
  color: string;
  colorName: string;
  shape: "circle" | "square";
  correct: boolean;
  tapped: boolean;
  spawnTs: number;
}

export interface GameStats {
  steerHits: number;
  steerPasses: number;
  tapCorrect: number;
  tapTotal: number;
  rtSum: number;
  rtCount: number;
}

export interface WorldTheme {
  sky: string;
  lane: string;
  accent: string;
  ship: string;
}

export const WORLD_THEMES: Record<number, WorldTheme> = {
  1: { sky: "#87CEEB", lane: "#4ade80", accent: "#fbbf24", ship: "#6366f1" },
  2: { sky: "#94a3b8", lane: "#059669", accent: "#a78bfa", ship: "#0ea5e9" },
  3: { sky: "#67e8f9", lane: "#14b8a6", accent: "#fb923c", ship: "#8b5cf6" },
  4: { sky: "#fdba74", lane: "#ea580c", accent: "#c084fc", ship: "#ec4899" },
};

export class TrainGameEngine {
  playerX = 0.5;
  gates: Gate[] = [];
  targets: Target[] = [];
  stats: GameStats = {
    steerHits: 0,
    steerPasses: 0,
    tapCorrect: 0,
    tapTotal: 0,
    rtSum: 0,
    rtCount: 0,
  };
  phaseStats: Record<string, GameStats> = {};
  private targetId = 0;
  private lastGateSpawn = 0;
  private lastTargetSpawn = 0;
  private steerKeys = { left: false, right: false };
  private rule: TargetRule;
  private runStartStats: GameStats | null = null;
  private steerBaseline = 0.8;
  private tapBaseline = 0.8;

  constructor(
    public difficulty: DifficultyState,
    public ruleComplexity: number
  ) {
    this.rule = ruleForComplexity(ruleComplexity);
  }

  setDifficulty(d: DifficultyState) {
    this.difficulty = d;
    this.rule = ruleForComplexity(d.rule_complexity);
  }

  setSteerKey(dir: "left" | "right", down: boolean) {
    this.steerKeys[dir] = down;
  }

  startRunSnapshot() {
    this.runStartStats = { ...this.stats };
  }

  private cloneStats(): GameStats {
    return { ...this.stats };
  }

  private diffStats(since: GameStats): GameStats {
    return {
      steerHits: this.stats.steerHits - since.steerHits,
      steerPasses: this.stats.steerPasses - since.steerPasses,
      tapCorrect: this.stats.tapCorrect - since.tapCorrect,
      tapTotal: this.stats.tapTotal - since.tapTotal,
      rtSum: this.stats.rtSum - since.rtSum,
      rtCount: this.stats.rtCount - since.rtCount,
    };
  }

  computeRunMetrics(phase: GamePhase, gazeEngagement = 0.85): RunMetrics {
    const since = this.runStartStats ?? this.cloneStats();
    const delta = this.diffStats(since);
    this.runStartStats = this.cloneStats();

    const steerAttempts = delta.steerHits + delta.steerPasses;
    const steerAcc =
      steerAttempts > 0 ? delta.steerPasses / steerAttempts : 0.8;
    const tapAcc =
      delta.tapTotal > 0 ? delta.tapCorrect / delta.tapTotal : 0.8;

    if (phase === "steer") this.steerBaseline = steerAcc;
    if (phase === "tap") this.tapBaseline = tapAcc;

    let multitaskCost = 0;
    if (phase === "multitask") {
      const combined = (steerAcc + tapAcc) / 2;
      const expected = (this.steerBaseline + this.tapBaseline) / 2;
      multitaskCost = Math.max(0, expected - combined);
    }

    const meanRt =
      delta.rtCount > 0 ? delta.rtSum / delta.rtCount : 450;

    return {
      phase,
      steer_accuracy: steerAcc,
      tap_accuracy: tapAcc,
      multitask_cost: multitaskCost,
      mean_rt_ms: meanRt,
      gaze_engagement: gazeEngagement,
      steer_attempts: steerAttempts,
      tap_attempts: delta.tapTotal,
    };
  }

  sessionAccuracy(): { steer: number; tap: number; multitask: number; meanRt: number } {
    const steerAttempts = this.stats.steerHits + this.stats.steerPasses;
    const steer = steerAttempts > 0 ? this.stats.steerPasses / steerAttempts : 0;
    const tap =
      this.stats.tapTotal > 0 ? this.stats.tapCorrect / this.stats.tapTotal : 0;
    const expected = (this.steerBaseline + this.tapBaseline) / 2;
    const combined = (steer + tap) / 2;
    const multitask = Math.max(0, expected - combined);
    const meanRt =
      this.stats.rtCount > 0 ? this.stats.rtSum / this.stats.rtCount : 0;
    return { steer, tap, multitask, meanRt };
  }

  update(
    dt: number,
    phase: GamePhase,
    canvasW: number,
    canvasH: number,
    now: number
  ) {
    const speed = this.difficulty.steer_speed * 120 * dt;
    const steerActive = phase === "steer" || phase === "multitask";
    const tapActive = phase === "tap" || phase === "multitask";

    if (this.steerKeys.left) this.playerX -= 1.8 * dt;
    if (this.steerKeys.right) this.playerX += 1.8 * dt;
    this.playerX = Math.max(0.08, Math.min(0.92, this.playerX));

    if (steerActive) {
      const interval = Math.max(0.8, 2.2 / this.difficulty.steer_speed);
      if (now - this.lastGateSpawn > interval) {
        this.lastGateSpawn = now;
        const gapWidth = 0.22 + (1.1 - this.difficulty.steer_speed) * 0.06;
        const gapX = 0.15 + Math.random() * (0.7 - gapWidth);
        this.gates.push({
          x: 0,
          y: -0.05,
          width: canvasW,
          gapX,
          gapWidth,
          passed: false,
          hit: false,
        });
      }

      const px = this.playerX * canvasW;
      const py = canvasH * 0.82;
      const shipR = 18;

      for (const gate of this.gates) {
        gate.y += speed / canvasH;
        const gapLeft = gate.gapX * canvasW;
        const gapRight = gapLeft + gate.gapWidth * canvasW;
        const gateY = gate.y * canvasH;

        if (!gate.passed && !gate.hit && gateY > py - shipR && gateY < py + shipR) {
          if (px >= gapLeft && px <= gapRight) {
            gate.passed = true;
            this.stats.steerPasses += 1;
          } else {
            gate.hit = true;
            this.stats.steerHits += 1;
          }
        }
      }
      this.gates = this.gates.filter((g) => g.y < 1.2);
    }

    if (tapActive) {
      const interval = Math.max(0.55, 1.6 / this.difficulty.target_rate);
      if (now - this.lastTargetSpawn > interval) {
        this.lastTargetSpawn = now;
        const isCorrect =
          Math.random() > this.difficulty.distractor_ratio;
        let colorIdx = COLORS.findIndex((c) => c.name === this.rule.color);
        let shape: "circle" | "square" = this.rule.shape;
        if (!isCorrect) {
          const others = COLORS.filter((c) => c.name !== this.rule.color);
          const pick = others[Math.floor(Math.random() * others.length)];
          colorIdx = COLORS.indexOf(pick);
          shape = SHAPES[Math.floor(Math.random() * SHAPES.length)];
        }
        const c = COLORS[colorIdx] ?? COLORS[0];
        const matchesRule =
          c.name === this.rule.color &&
          (this.difficulty.rule_complexity < 2 || shape === this.rule.shape);
        this.targets.push({
          id: this.targetId++,
          x: 0.72 + Math.random() * 0.2,
          y: -0.05,
          color: c.hex,
          colorName: c.name,
          shape,
          correct: matchesRule,
          tapped: false,
          spawnTs: now,
        });
      }

      for (const t of this.targets) {
        t.y += (speed * 0.85) / canvasH;
      }
      this.targets = this.targets.filter((t) => t.y < 1.15 && !t.tapped);
    }
  }

  tapTarget(now: number): boolean {
    const hit = this.targets.find(
      (t) => !t.tapped && t.y > 0.25 && t.y < 0.95
    );
    if (!hit) return false;
    hit.tapped = true;
    this.stats.tapTotal += 1;
    const rt = (now - hit.spawnTs) * 1000;
    this.stats.rtSum += rt;
    this.stats.rtCount += 1;
    if (hit.correct) this.stats.tapCorrect += 1;
    return hit.correct;
  }

  draw(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    phase: GamePhase,
    theme: WorldTheme,
    rule: TargetRule
  ) {
    ctx.fillStyle = theme.sky;
    ctx.fillRect(0, 0, w, h);

    if (phase === "intro") return;

    const steerActive = phase === "steer" || phase === "multitask";
    const tapActive = phase === "tap" || phase === "multitask";

    if (steerActive) {
      ctx.fillStyle = theme.lane;
      ctx.fillRect(0, h * 0.55, w * 0.65, h * 0.45);

      for (const gate of this.gates) {
        const gy = gate.y * h;
        ctx.fillStyle = theme.accent;
        ctx.fillRect(0, gy, gate.gapX * w, 14);
        ctx.fillRect(
          (gate.gapX + gate.gapWidth) * w,
          gy,
          w - (gate.gapX + gate.gapWidth) * w,
          14
        );
      }

      const px = this.playerX * w;
      const py = h * 0.82;
      ctx.fillStyle = theme.ship;
      ctx.beginPath();
      ctx.moveTo(px, py - 22);
      ctx.lineTo(px - 18, py + 16);
      ctx.lineTo(px + 18, py + 16);
      ctx.closePath();
      ctx.fill();
    }

    if (tapActive) {
      ctx.fillStyle = "rgba(255,255,255,0.12)";
      ctx.fillRect(w * 0.62, 0, w * 0.38, h);
      ctx.fillStyle = "rgba(255,255,255,0.5)";
      ctx.font = "13px system-ui";
      ctx.fillText(rule.label, w * 0.64, 28);

      for (const t of this.targets) {
        const tx = t.x * w;
        const ty = t.y * h;
        ctx.fillStyle = t.color;
        if (t.shape === "circle") {
          ctx.beginPath();
          ctx.arc(tx, ty, 22, 0, Math.PI * 2);
          ctx.fill();
        } else {
          ctx.fillRect(tx - 22, ty - 22, 44, 44);
        }
      }
    }
  }
}

export const MICRO_RUN_SECS = 75;
export const STEER_WARMUP_SECS = 30;
export const TAP_WARMUP_SECS = 30;
export const INTRO_SECS = 5;
export const DEFAULT_MISSION_MINUTES = 10;

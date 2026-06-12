import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { useWindowResize, useGlobalShortcuts } from ".";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useApp } from "@/contexts";
import { fetchSTT, fetchAIResponse } from "@/lib/functions";
import {
  ATTACH_SCREENSHOT_TO_COMPLETION_EVENT,
  DEFAULT_QUICK_ACTIONS,
  DEFAULT_SYSTEM_PROMPT,
  STORAGE_KEYS,
} from "@/config";
import {
  safeLocalStorage,
  shouldUseHostedAPI,
  generateConversationTitle,
  saveConversation,
  CONVERSATION_SAVE_DEBOUNCE_MS,
  generateConversationId,
  generateMessageId,
  buildInterviewContextBlock,
  buildSystemAudioAnswerStyleBlock,
  buildConciseModeInstructions,
} from "@/lib";
import { Message } from "@/types/completion";

// VAD Configuration interface matching Rust
export interface VadConfig {
  enabled: boolean;
  hop_size: number;
  sensitivity_rms: number;
  peak_threshold: number;
  silence_chunks: number;
  min_speech_chunks: number;
  pre_speech_chunks: number;
  noise_gate_threshold: number;
  max_recording_duration_secs: number;
  streaming_chunk_secs: number;
}

const DEFAULT_VAD_CONFIG: VadConfig = {
  enabled: false,
  hop_size: 1024,
  sensitivity_rms: 0.003,
  peak_threshold: 0.010,
  silence_chunks: 35,
  min_speech_chunks: 4,
  pre_speech_chunks: 15,
  noise_gate_threshold: 0.0008,
  max_recording_duration_secs: 3600,
  streaming_chunk_secs: 2,
};

// Chat message interface (reusing from useCompletion)
interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: number;
}

// Conversation interface (reusing from useCompletion)
export interface ChatConversation {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
}

// Segment of transcribed system audio
export interface TranscriptEntry {
  id: string;
  text: string;
  timestamp: number;
}

const STT_OVERLAP_MIN_CHARS = 4;

/**
 * Merge consecutive streaming STT results when the model repeats or extends prior text.
 * Returns null when `next` should be a separate segment.
 */
function mergeAdjacentTranscriptChunks(
  previous: string,
  next: string
): string | null {
  const a = previous.trim().replace(/\s+/g, " ");
  const b = next.trim().replace(/\s+/g, " ");
  if (!b) return null;
  if (!a) return b;
  if (a === b) return a;
  if (b.startsWith(a) && b.length > a.length) return b;
  if (a.length >= b.length + 10 && a.endsWith(b)) return a;
  if (b.length >= a.length + 10 && b.endsWith(a)) return b;

  const maxK = Math.min(a.length, b.length, 200);
  for (let k = maxK; k >= STT_OVERLAP_MIN_CHARS; k--) {
    if (a.slice(-k) === b.slice(0, k)) {
      const tail = b.slice(k).trimStart();
      if (!tail) return a;
      const gap =
        /[.!?,;:]$/u.test(a) || /^[.!?,;:'"([{]/u.test(tail) ? " " : " ";
      return (a + gap + tail).replace(/\s+/g, " ").trim();
    }
  }
  return null;
}

export interface TranscriptInsight {
  summary: string;
  questions: string[];
}

export type InterviewPerformanceStatus = "good" | "caution" | "needs_work";

export interface InterviewPerformanceMetric {
  key: string;
  label: string;
  score: number;
  status: InterviewPerformanceStatus;
}

/** Fixed performance dimensions (order preserved in UI and for the AI JSON). */
export const INTERVIEW_PERFORMANCE_SPECS = [
  { key: "accuracy", label: "Accuracy" },
  { key: "relevance", label: "Relevance" },
  { key: "confidence", label: "Confidence" },
  { key: "clarity", label: "Clarity" },
  { key: "structure", label: "Structure" },
] as const;

export type InterviewPerformanceMetricKey =
  (typeof INTERVIEW_PERFORMANCE_SPECS)[number]["key"];

function resolveInterviewMetricKey(
  keyRaw: string,
  label: string
): InterviewPerformanceMetricKey | null {
  const k = keyRaw
    .toLowerCase()
    .trim()
    .replace(/&/g, "and")
    .replace(/[^\w]+/g, "_")
    .replace(/^_+|_+$/g, "");
  const allowed = new Set<string>(
    INTERVIEW_PERFORMANCE_SPECS.map((s) => s.key)
  );
  if (allowed.has(k)) return k as InterviewPerformanceMetricKey;

  const l = label.toLowerCase();
  if (/accur|correct|factual/.test(l)) return "accuracy";
  if (/relev|on[- ]?topic|fit|align/.test(l)) return "relevance";
  if (/confid|assert|hesitat/.test(l)) return "confidence";
  if (/\bstruct|organiz|logical flow\b/.test(l)) return "structure";
  if (/\bclarity\b|\bclear\b/.test(l)) return "clarity";
  return null;
}

export interface InterviewPerformanceSnapshot {
  overall: number;
  overallLabel: string;
  metrics: InterviewPerformanceMetric[];
  source: "ai" | "heuristic";
  /** AI only: main question to answer next */
  focusQuestion?: string;
  /** AI only: substance/delivery gaps to fix */
  gaps?: string[];
  /** AI only: grounded outline bullets */
  suggestedOutline?: string[];
  /** AI only: optional short draft from coach model */
  optionalFullAnswer?: string;
}

function clampScore(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

function statusFromScore(s: number): InterviewPerformanceStatus {
  if (s >= 70) return "good";
  if (s >= 45) return "caution";
  return "needs_work";
}

function parseCoachStringList(
  val: unknown,
  maxItems: number,
  maxItemLen: number
): string[] {
  if (!Array.isArray(val)) return [];
  return val
    .filter((x): x is string => typeof x === "string")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, maxItems)
    .map((s) => s.slice(0, maxItemLen));
}

function computeHeuristicInterviewPerformance(
  entries: TranscriptEntry[]
): InterviewPerformanceSnapshot | null {
  const text = entries.map((e) => e.text).join(" ").trim();
  if (text.length < 24) return null;

  const words = text.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length < 6) return null;

  const fillerRe =
    /\b(um|uh|umm|uhh|er|ah|like|you know|sort of|kind of|basically|actually)\b/gi;
  const fillerCount = (text.toLowerCase().match(fillerRe) || []).length;
  const fillerRatio = fillerCount / words.length;

  const confidence = Math.round(
    clampScore(100 - fillerRatio * 280, 28, 96)
  );

  const rawSentences = text
    .split(/[.!?]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const sentenceWordCounts = rawSentences
    .map((s) => s.split(/\s+/).filter(Boolean).length)
    .filter((n) => n > 0);
  const avgLen = sentenceWordCounts.length
    ? sentenceWordCounts.reduce((a, b) => a + b, 0) /
      sentenceWordCounts.length
    : words.length;
  const sentenceCount = rawSentences.length || (text.length > 0 ? 1 : 0);

  const clarity = Math.round(
    clampScore(110 - Math.abs(avgLen - 14) * 2.5, 35, 92)
  );

  const unique = new Set(words);
  const ttr = unique.size / words.length;
  const accuracy = Math.round(clampScore(45 + ttr * 55, 40, 95));

  const structure = Math.round(
    clampScore(
      40 +
        Math.min(sentenceCount, 7) * 7 +
        (sentenceCount >= 2 ? 6 : 0) -
        (avgLen > 42 ? 16 : 0) -
        (avgLen < 6 && words.length > 24 ? 10 : 0),
      30,
      93
    )
  );

  const relevance = Math.round(
    clampScore(accuracy * 0.38 + confidence * 0.32 + clarity * 0.3, 38, 95)
  );

  const st = statusFromScore;
  const metrics: InterviewPerformanceMetric[] = INTERVIEW_PERFORMANCE_SPECS.map(
    ({ key, label }) => {
      const score =
        key === "accuracy"
          ? accuracy
          : key === "relevance"
            ? relevance
            : key === "confidence"
              ? confidence
              : key === "clarity"
                ? clarity
                : structure;
      return { key, label, score, status: st(score) };
    }
  );

  const overall = Math.round(
    metrics.reduce((s, m) => s + m.score, 0) / metrics.length
  );

  return {
    overall,
    overallLabel: "Expression",
    source: "heuristic",
    metrics,
  };
}

function parseInterviewPerformanceJson(
  raw: string
): InterviewPerformanceSnapshot | null {
  let s = raw.trim();
  const fence = /^```(?:json)?\s*([\s\S]*?)```$/im;
  const m = s.match(fence);
  if (m) s = m[1].trim();
  try {
    const o = JSON.parse(s) as Record<string, unknown>;
    const overallRaw = o.overall;
    if (typeof overallRaw !== "number" || Number.isNaN(overallRaw)) {
      return null;
    }
    const overall = clampScore(Math.round(overallRaw), 0, 100);
    const overallLabel =
      typeof o.overallLabel === "string" && o.overallLabel.trim()
        ? o.overallLabel.trim().slice(0, 48)
        : "Expression";

    const rawMetrics = Array.isArray(o.metrics) ? o.metrics : [];
    const byKey = new Map<
      InterviewPerformanceMetricKey,
      { score: number; status: InterviewPerformanceStatus }
    >();

    for (const item of rawMetrics) {
      if (!item || typeof item !== "object") continue;
      const rec = item as Record<string, unknown>;
      const label = typeof rec.label === "string" ? rec.label.trim() : "";
      const keyRaw = typeof rec.key === "string" ? rec.key.trim() : "";
      const scoreRaw = rec.score;
      const score =
        typeof scoreRaw === "number" && !Number.isNaN(scoreRaw)
          ? clampScore(Math.round(scoreRaw), 0, 100)
          : 50;
      const st = rec.status;
      let status: InterviewPerformanceStatus = statusFromScore(score);
      if (
        st === "good" ||
        st === "caution" ||
        st === "needs_work"
      ) {
        status = st;
      }

      const l = label.toLowerCase();
      if (/\bclarity\b/.test(l) && /\bstruct/.test(l)) {
        byKey.set("clarity", { score, status });
        byKey.set("structure", { score, status });
        continue;
      }

      const canon = resolveInterviewMetricKey(keyRaw, label);
      if (!canon) continue;
      byKey.set(canon, { score, status });
    }

    const metrics: InterviewPerformanceMetric[] =
      INTERVIEW_PERFORMANCE_SPECS.map(({ key, label }) => {
        const hit = byKey.get(key);
        const score = hit?.score ?? 50;
        const status = hit?.status ?? statusFromScore(score);
        return { key, label, score, status };
      });

    const focusRaw = o.focusQuestion;
    const focusQuestion =
      typeof focusRaw === "string" ? focusRaw.trim().slice(0, 500) : "";
    const gaps = parseCoachStringList(o.gaps, 5, 280);
    const suggestedOutline = parseCoachStringList(
      o.suggestedOutline,
      8,
      320
    );
    const draftRaw = o.optionalFullAnswer;
    const optionalFullAnswer =
      typeof draftRaw === "string" ? draftRaw.trim().slice(0, 2000) : "";

    return {
      overall,
      overallLabel,
      metrics,
      source: "ai",
      ...(focusQuestion ? { focusQuestion } : {}),
      ...(gaps.length ? { gaps } : {}),
      ...(suggestedOutline.length ? { suggestedOutline } : {}),
      ...(optionalFullAnswer ? { optionalFullAnswer } : {}),
    };
  } catch {
    return null;
  }
}

const TRANSCRIPT_INSIGHT_SYSTEM = `You analyze live meeting or interview transcripts. Reply with ONLY valid JSON (no markdown fences, no commentary) in this exact shape:
{"summary":"string","questions":["string"]}
Rules:
- "summary": 1–3 neutral sentences describing what was discussed.
- "questions": distinct questions or prompts someone might need to answer. At most 8 items; use [] if none. Quote or paraphrase briefly from the transcript.`;

/** How often to refresh live insights while capturing (wall clock). */
const TRANSCRIPT_INSIGHT_INTERVAL_MS = 15_000;
const TRANSCRIPT_INSIGHT_MIN_CHARS = 40;

const INTERVIEW_PERFORMANCE_INTERVAL_MS = 22_000;
const INTERVIEW_PERFORMANCE_MIN_CHARS = 48;

const INTERVIEW_PERFORMANCE_SYSTEM = `You coach live interview delivery from transcript audio (what the candidate or participant said). Reply with ONLY valid JSON (no markdown fences, no commentary) in this exact shape:
{"overall":0-100,"overallLabel":"short label like Expression or Delivery","metrics":[{"key":"accuracy","label":"Accuracy","score":0-100,"status":"good"|"caution"|"needs_work"},{"key":"relevance","label":"Relevance","score":0-100,"status":"good"|"caution"|"needs_work"},{"key":"confidence","label":"Confidence","score":0-100,"status":"good"|"caution"|"needs_work"},{"key":"clarity","label":"Clarity","score":0-100,"status":"good"|"caution"|"needs_work"},{"key":"structure","label":"Structure","score":0-100,"status":"good"|"caution"|"needs_work"}],"focusQuestion":"","gaps":[],"suggestedOutline":[],"optionalFullAnswer":""}
Rules:
- Infer the speaker's performance from the transcript only (content, structure, confidence cues in wording).
- overall: holistic score for how well they are doing in the interview right now.
- metrics: MUST include exactly these five keys in this order: accuracy, relevance, confidence, clarity, structure. Score each 0–100. Do not add other metrics. Do not include feedback, explanations, or prose inside metrics—only key, label, score, status per item.
- Accuracy: factual correctness and precision of what they said.
- Relevance: how well the content addresses the implied or explicit question / topic.
- Confidence: how assured and decisive the wording sounds (vs hesitant or vague).
- Clarity: how easy the ideas are to follow; plain, concrete language.
- Structure: logical ordering, signposting, beginning/middle/end of the answer.
- status: good if score about 70+, caution if about 45–69, needs_work if lower (adjust slightly for context).
- focusQuestion: the single most important question or prompt they should answer next (paraphrase from transcript). Empty string if unclear.
- gaps: 0–4 short strings on substance or delivery weaknesses (vague, off-topic, missing example, weak structure, etc.).
- suggestedOutline: 3–6 bullets — concrete talking points they should hit next. Base on transcript themes; the app will merge with their resume/JD in a later step, so note gaps ("add metric X") where the transcript lacked specificity.
- optionalFullAnswer: optional 2–4 sentence first-person draft they could say, or empty string. Do not invent employers, dates, or metrics not hinted in the transcript; prefer "I would quantify with…" over fake numbers.`;

/** Wall-clock interval to fold older transcript into a running summary (STT still streams in small chunks). */
const TRANSCRIPT_ROLLUP_INTERVAL_MS = 60_000;
const TRANSCRIPT_ROLLUP_MIN_CHARS = 120;
const TRANSCRIPT_ROLLUP_SYSTEM = `You maintain a running meeting or interview summary. Output plain text only (short paragraphs or bullet phrases; no markdown headings).

Merge "Previous summary" with "New verbatim transcript" into ONE updated summary. Preserve names, numbers, decisions, action items, and open questions. Drop filler and repetition. Cap total length around 3500 characters. If Previous summary is empty, summarize only the New verbatim transcript.`;

function buildTranscriptContextForPrompt(
  rolledSummary: string,
  entries: TranscriptEntry[],
  rollupThroughIndex: number
): string {
  const recent = entries
    .slice(rollupThroughIndex)
    .map((e) => e.text)
    .join(" ")
    .trim();
  const sum = rolledSummary.trim();
  if (!sum && !recent) return "";
  const parts: string[] = [];
  if (sum) {
    parts.push(`Earlier meeting (rolled-up summary):\n${sum}`);
  }
  if (recent) {
    parts.push(`Recent verbatim transcript:\n${recent}`);
  }
  return parts.join("\n\n");
}

function buildInsightTranscriptPayload(
  rolledSummary: string,
  entries: TranscriptEntry[],
  rollupThroughIndex: number
): string {
  const recent = entries
    .slice(rollupThroughIndex)
    .map((e) => e.text)
    .join(" ")
    .trim();
  const sum = rolledSummary.trim();
  const parts: string[] = [];
  if (sum) parts.push(`Earlier (summary): ${sum}`);
  if (recent) parts.push(`Recent verbatim: ${recent}`);
  return parts.join("\n\n").trim();
}

function parseTranscriptInsightJson(raw: string): TranscriptInsight {
  let s = raw.trim();
  const fence = /^```(?:json)?\s*([\s\S]*?)```$/im;
  const m = s.match(fence);
  if (m) s = m[1].trim();
  try {
    const o = JSON.parse(s) as { summary?: unknown; questions?: unknown };
    const summary = typeof o.summary === "string" ? o.summary.trim() : "";
    const questions = Array.isArray(o.questions)
      ? o.questions
          .filter((q): q is string => typeof q === "string")
          .map((q) => q.trim())
          .filter(Boolean)
          .slice(0, 8)
      : [];
    return { summary, questions };
  } catch {
    return { summary: "", questions: [] };
  }
}

export type useSystemAudioType = ReturnType<typeof useSystemAudio>;

export function useSystemAudio() {
  const { resizeWindow } = useWindowResize();
  const globalShortcuts = useGlobalShortcuts();
  const [isPopoverOpen, setIsPopoverOpen] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [paused, setPaused] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isAIProcessing, setIsAIProcessing] = useState(false);
  const [lastTranscription, setLastTranscription] = useState<string>("");
  const [lastAIResponse, setLastAIResponse] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [setupRequired, setSetupRequired] = useState<boolean>(false);
  const [quickActions, setQuickActions] = useState<string[]>([]);
  const [isManagingQuickActions, setIsManagingQuickActions] =
    useState<boolean>(false);
  const [showQuickActions, setShowQuickActions] = useState<boolean>(true);
  const [vadConfig, setVadConfig] = useState<VadConfig>(DEFAULT_VAD_CONFIG);
  const [recordingProgress, setRecordingProgress] = useState<number>(0);
  const [systemAudioScreenshotBase64, setSystemAudioScreenshotBase64] =
    useState<string | null>(null);
  const systemAudioScreenshotRef = useRef<string | null>(null);
  const [isScreenshotAnalyzing, setIsScreenshotAnalyzing] = useState(false);

  useEffect(() => {
    systemAudioScreenshotRef.current = systemAudioScreenshotBase64;
  }, [systemAudioScreenshotBase64]);

  // Pipeline diagnostics: tracks where in the audio pipeline we are
  const [captureStatus, setCaptureStatus] = useState<
    | "idle"
    | "starting"
    | "active"
    | "speech"
    | "transcribing"
    | "error"
  >("idle");
  const [speechSegmentCount, setSpeechSegmentCount] = useState<number>(0);

  const [conversation, setConversation] = useState<ChatConversation>({
    id: "",
    title: "",
    messages: [],
    createdAt: 0,
    updatedAt: 0,
  });

  const [transcriptEntries, setTranscriptEntries] = useState<
    TranscriptEntry[]
  >([]);

  // Context management states
  const [useSystemPrompt, setUseSystemPrompt] = useState<boolean>(true);
  const [contextContent, setContextContent] = useState<string>("");
  const [conciseMode, setConciseMode] = useState<boolean>(() => {
    const stored = safeLocalStorage.getItem(STORAGE_KEYS.CONCISE_MODE);
    return stored ? JSON.parse(stored) : false;
  });
  const [autoTranscriptInsights, setAutoTranscriptInsights] =
    useState<boolean>(true);
  const [transcriptInsight, setTranscriptInsight] =
    useState<TranscriptInsight | null>(null);
  const [insightsLoading, setInsightsLoading] = useState(false);
  const [insightError, setInsightError] = useState<string>("");
  const [autoTranscriptRollup, setAutoTranscriptRollup] = useState(true);
  const [transcriptRollupSummary, setTranscriptRollupSummary] = useState("");
  const [transcriptRollupThroughIndex, setTranscriptRollupThroughIndex] =
    useState(0);
  const [rollupLoading, setRollupLoading] = useState(false);

  const [autoInterviewPerformance, setAutoInterviewPerformance] =
    useState(true);
  const [interviewPerformanceAI, setInterviewPerformanceAI] =
    useState<InterviewPerformanceSnapshot | null>(null);
  const [performanceLoading, setPerformanceLoading] = useState(false);
  const [performanceError, setPerformanceError] = useState("");

  const {
    selectedSttProvider,
    allSttProviders,
    selectedAIProvider,
    allAiProviders,
    systemPrompt,
    screenshotConfiguration,
    selectedAudioDevices,
    supportsImages,
    interviewAnswerType,
    interviewCustomPrompts,
    interviewContext,
  } = useApp();

  const interviewOverrides = useMemo(
    () => ({
      answerType: interviewAnswerType,
      customPrompts: interviewCustomPrompts,
      interviewContext,
    }),
    [interviewAnswerType, interviewCustomPrompts, interviewContext]
  );

  const attachSystemAudioScreenshot = useCallback(
    (base64: string) => {
      setSystemAudioScreenshotBase64(base64);
      if (supportsImages) {
        window.dispatchEvent(
          new CustomEvent(ATTACH_SCREENSHOT_TO_COMPLETION_EVENT, {
            detail: { base64 },
          })
        );
      }
    },
    [supportsImages]
  );

  const removeSystemAudioScreenshot = useCallback(() => {
    setSystemAudioScreenshotBase64(null);
  }, []);

  const abortControllerRef = useRef<AbortController | null>(null);
  const insightAbortRef = useRef<AbortController | null>(null);
  const performanceAbortRef = useRef<AbortController | null>(null);
  const rollupAbortRef = useRef<AbortController | null>(null);
  const rollupInFlightRef = useRef(false);
  const transcriptRollupSummaryRef = useRef("");
  const transcriptRollupThroughIndexRef = useRef(0);
  const lastInsightFingerprintRef = useRef<string>("");
  const lastPerformanceFingerprintRef = useRef<string>("");
  const setupRequiredRef = useRef(setupRequired);
  setupRequiredRef.current = setupRequired;

  transcriptRollupSummaryRef.current = transcriptRollupSummary;
  transcriptRollupThroughIndexRef.current = transcriptRollupThroughIndex;
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isSavingRef = useRef<boolean>(false);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const capturingRef = useRef<boolean>(false);
  const transcriptEntriesRef = useRef<TranscriptEntry[]>([]);
  const sttProviderRef = useRef(selectedSttProvider);
  const allSttProvidersRef = useRef(allSttProviders);
  sttProviderRef.current = selectedSttProvider;
  allSttProvidersRef.current = allSttProviders;

  // Bookmark: index of first unanswered transcript entry
  const lastAnsweredIndexRef = useRef<number>(0);
  const [lastAnsweredIndex, setLastAnsweredIndex] = useState<number>(0);
  // Load context settings and VAD config from localStorage on mount
  useEffect(() => {
    const savedContext = safeLocalStorage.getItem(
      STORAGE_KEYS.SYSTEM_AUDIO_CONTEXT
    );
    if (savedContext) {
      try {
        const parsed = JSON.parse(savedContext);
        setUseSystemPrompt(parsed.useSystemPrompt ?? true);
        setContextContent(parsed.contextContent ?? "");
        setAutoTranscriptInsights(parsed.autoTranscriptInsights !== false);
        setAutoTranscriptRollup(parsed.autoTranscriptRollup !== false);
        setAutoInterviewPerformance(
          parsed.autoInterviewPerformance !== false
        );
      } catch (error) {
        console.error("Failed to load system audio context:", error);
      }
    }

    // Load VAD config (merge defaults; lift old 3 min cap default to 10 min for long meetings)
    const savedVadConfig = safeLocalStorage.getItem("vad_config");
    if (savedVadConfig) {
      try {
        const parsed = JSON.parse(savedVadConfig) as Partial<VadConfig>;
        const merged: VadConfig = {
          ...DEFAULT_VAD_CONFIG,
          ...parsed,
          streaming_chunk_secs:
            typeof parsed.streaming_chunk_secs === "number"
              ? parsed.streaming_chunk_secs
              : DEFAULT_VAD_CONFIG.streaming_chunk_secs,
        };
        let maxSec = merged.max_recording_duration_secs;
        if (maxSec === 180) {
          maxSec = 3600;
        }
        maxSec = Math.min(3600, Math.max(60, maxSec));
        merged.max_recording_duration_secs = maxSec;

        const prevMax = parsed.max_recording_duration_secs;
        const prevChunk = parsed.streaming_chunk_secs;
        if (prevMax !== maxSec || typeof prevChunk !== "number") {
          safeLocalStorage.setItem("vad_config", JSON.stringify(merged));
        }
        setVadConfig(merged);
      } catch (error) {
        console.error("Failed to load VAD config:", error);
      }
    }
  }, []);

  // Load quick actions from localStorage on mount
  useEffect(() => {
    const savedActions = safeLocalStorage.getItem(
      STORAGE_KEYS.SYSTEM_AUDIO_QUICK_ACTIONS
    );
    if (savedActions) {
      try {
        const parsed = JSON.parse(savedActions);
        setQuickActions(parsed);
      } catch (error) {
        console.error("Failed to load quick actions:", error);
        setQuickActions(DEFAULT_QUICK_ACTIONS);
      }
    } else {
      setQuickActions(DEFAULT_QUICK_ACTIONS);
    }
  }, []);

  // Core audio pipeline event listeners
  useEffect(() => {
    let progressUnlisten: (() => void) | undefined;
    let errorUnlisten: (() => void) | undefined;
    let discardedUnlisten: (() => void) | undefined;
    let captureStartedUnlisten: (() => void) | undefined;
    let captureStoppedUnlisten: (() => void) | undefined;
    let speechStartUnlisten: (() => void) | undefined;
    let permissionUnlisten: (() => void) | undefined;

    const setupListeners = async () => {
      try {
        captureStartedUnlisten = await listen(
          "capture-started",
          (event) => {
            const sampleRate = event.payload as number;
            console.log(
              "[SystemAudio] Capture started, sample rate:",
              sampleRate
            );
            setCaptureStatus("active");
          }
        );

        captureStoppedUnlisten = await listen("capture-stopped", () => {
          console.log("[SystemAudio] Capture stopped");
          setCaptureStatus("idle");
        });

        speechStartUnlisten = await listen("speech-start", () => {
          console.log("[SystemAudio] Speech start detected by VAD");
          setCaptureStatus("speech");
          setSpeechSegmentCount((c) => c + 1);
        });

        progressUnlisten = await listen("recording-progress", (event) => {
          const seconds = event.payload as number;
          setRecordingProgress(seconds);
        });

        errorUnlisten = await listen("audio-encoding-error", (event) => {
          const errorMsg = event.payload as string;
          console.error("[SystemAudio] Encoding error:", errorMsg);
          setError(`Failed to process audio: ${errorMsg}`);
          setCaptureStatus("error");
          setIsProcessing(false);
          setIsAIProcessing(false);
        });

        discardedUnlisten = await listen("speech-discarded", (event) => {
          const reason = event.payload as string;
          console.log("[SystemAudio] Speech discarded:", reason);
          setCaptureStatus("active");
        });

        permissionUnlisten = await listen(
          "audio-permission-issue",
          (event) => {
            const msg = event.payload as string;
            console.warn("[SystemAudio] Permission issue:", msg);
            setError(msg);
            setCaptureStatus("error");
          }
        );
      } catch (err) {
        console.error("[SystemAudio] Failed to setup listeners:", err);
      }
    };

    setupListeners();

    return () => {
      captureStartedUnlisten?.();
      captureStoppedUnlisten?.();
      speechStartUnlisten?.();
      progressUnlisten?.();
      errorUnlisten?.();
      discardedUnlisten?.();
      permissionUnlisten?.();
    };
  }, []);

  // Handle speech-detected events from the backend.
  // Uses refs for provider values to avoid stale closures in streaming mode
  // where events fire every 2 seconds.
  useEffect(() => {
    let cancelled = false;
    let speechUnlisten: (() => void) | undefined;

    const setupEventListener = async () => {
      try {
        const unlisten = await listen("speech-detected", async (event) => {
          try {
            if (!capturingRef.current) return;

            const base64Audio = event.payload as string;
            setCaptureStatus("transcribing");
            setSpeechSegmentCount((c) => c + 1);

            const binaryString = atob(base64Audio);
            const bytes = new Uint8Array(binaryString.length);
            for (let i = 0; i < binaryString.length; i++) {
              bytes[i] = binaryString.charCodeAt(i);
            }
            const audioBlob = new Blob([bytes], { type: "audio/wav" });

            const currentSttProvider = sttProviderRef.current;
            const currentAllSttProviders = allSttProvidersRef.current;

            const useHostedAPI = await shouldUseHostedAPI();
            if (!currentSttProvider.provider && !useHostedAPI) {
              console.warn("[SystemAudio] No STT provider configured, skipping chunk");
              setCaptureStatus("active");
              return;
            }

            const providerConfig = currentAllSttProviders.find(
              (p) => p.id === currentSttProvider.provider
            );

            if (!providerConfig && !useHostedAPI) {
              console.warn("[SystemAudio] STT provider config not found, skipping chunk");
              setCaptureStatus("active");
              return;
            }

            setIsProcessing(true);

            const sttPromise = fetchSTT({
              provider: providerConfig,
              selectedProvider: currentSttProvider,
              audio: audioBlob,
            });

            const timeoutPromise = new Promise<string>((_, reject) => {
              setTimeout(
                () => reject(new Error("Transcription timed out (30s)")),
                30000
              );
            });

            try {
              const transcription = await Promise.race([
                sttPromise,
                timeoutPromise,
              ]);

              const trimmedTx = transcription.trim();
              if (trimmedTx) {
                const timestamp = Date.now();
                const entriesSnap = transcriptEntriesRef.current;
                const prevLast = entriesSnap[entriesSnap.length - 1];

                if (
                  prevLast &&
                  prevLast.text.trim() === trimmedTx &&
                  timestamp - prevLast.timestamp < 4000
                ) {
                  setCaptureStatus("active");
                  return;
                }

                setLastTranscription(transcription);
                setError("");

                const merged: string | null = prevLast
                  ? mergeAdjacentTranscriptChunks(prevLast.text, trimmedTx)
                  : null;
                const prevNorm = prevLast?.text.trim().replace(/\s+/g, " ") ?? "";
                const mergedNorm =
                  merged?.trim().replace(/\s+/g, " ") ?? "";

                if (prevLast && merged !== null && mergedNorm === prevNorm) {
                  setCaptureStatus("active");
                  return;
                }

                if (prevLast && merged !== null && mergedNorm !== prevNorm) {
                  const updated: TranscriptEntry = {
                    ...prevLast,
                    text: merged,
                    timestamp,
                  };
                  transcriptEntriesRef.current = [
                    ...entriesSnap.slice(0, -1),
                    updated,
                  ];
                  setTranscriptEntries((prev) => [
                    ...prev.slice(0, -1),
                    updated,
                  ]);

                  setConversation((prev) => {
                    const msgs = [...prev.messages];
                    const lastIdx = msgs.length - 1;
                    if (lastIdx >= 0 && msgs[lastIdx].role === "user") {
                      msgs[lastIdx] = {
                        ...msgs[lastIdx],
                        content: merged,
                        timestamp,
                      };
                    }
                    return {
                      ...prev,
                      messages: msgs,
                      updatedAt: timestamp,
                      title: prev.title || generateConversationTitle(merged),
                    };
                  });
                } else {
                  const entry: TranscriptEntry = {
                    id: generateMessageId("seg", timestamp),
                    text: transcription,
                    timestamp,
                  };

                  transcriptEntriesRef.current = [
                    ...transcriptEntriesRef.current,
                    entry,
                  ];
                  setTranscriptEntries((prev) => [...prev, entry]);

                  setConversation((prev) => {
                    const title =
                      prev.title || generateConversationTitle(transcription);
                    return {
                      ...prev,
                      messages: [
                        ...prev.messages,
                        {
                          id: entry.id,
                          role: "user" as const,
                          content: transcription,
                          timestamp,
                        },
                      ],
                      updatedAt: timestamp,
                      title,
                    };
                  });
                }
              }

              setCaptureStatus("active");
            } catch (sttError: any) {
              console.error("[SystemAudio] STT Error:", sttError);
              setError(sttError.message || "Failed to transcribe audio");
              setCaptureStatus("active");
            }
          } catch (err) {
            console.error("[SystemAudio] speech-detected handler error:", err);
            setCaptureStatus("active");
          } finally {
            setIsProcessing(false);
          }
        });
        if (cancelled) {
          unlisten();
          return;
        }
        speechUnlisten = unlisten;
      } catch (err) {
        console.error("Failed to setup speech listener:", err);
      }
    };

    void setupEventListener();

    return () => {
      cancelled = true;
      speechUnlisten?.();
    };
  }, []);

  // Context management functions
  const saveContextSettings = useCallback(
    (
      usePrompt: boolean,
      content: string,
      autoInsights: boolean,
      autoRollup: boolean,
      autoPerformance: boolean
    ) => {
      try {
        const contextSettings = {
          useSystemPrompt: usePrompt,
          contextContent: content,
          autoTranscriptInsights: autoInsights,
          autoTranscriptRollup: autoRollup,
          autoInterviewPerformance: autoPerformance,
        };
        safeLocalStorage.setItem(
          STORAGE_KEYS.SYSTEM_AUDIO_CONTEXT,
          JSON.stringify(contextSettings)
        );
      } catch (error) {
        console.error("Failed to save context settings:", error);
      }
    },
    []
  );

  const updateUseSystemPrompt = useCallback(
    (value: boolean) => {
      setUseSystemPrompt(value);
      saveContextSettings(
        value,
        contextContent,
        autoTranscriptInsights,
        autoTranscriptRollup,
        autoInterviewPerformance
      );
    },
    [
      contextContent,
      autoTranscriptInsights,
      autoTranscriptRollup,
      autoInterviewPerformance,
      saveContextSettings,
    ]
  );

  const updateContextContent = useCallback(
    (content: string) => {
      setContextContent(content);
      saveContextSettings(
        useSystemPrompt,
        content,
        autoTranscriptInsights,
        autoTranscriptRollup,
        autoInterviewPerformance
      );
    },
    [
      useSystemPrompt,
      autoTranscriptInsights,
      autoTranscriptRollup,
      autoInterviewPerformance,
      saveContextSettings,
    ]
  );

  const updateConciseMode = useCallback((value: boolean) => {
    setConciseMode(value);
    safeLocalStorage.setItem(STORAGE_KEYS.CONCISE_MODE, JSON.stringify(value));
  }, []);

  const updateAutoTranscriptInsights = useCallback(
    (value: boolean) => {
      setAutoTranscriptInsights(value);
      saveContextSettings(
        useSystemPrompt,
        contextContent,
        value,
        autoTranscriptRollup,
        autoInterviewPerformance
      );
      if (!value) {
        if (insightAbortRef.current) {
          insightAbortRef.current.abort();
          insightAbortRef.current = null;
        }
        setInsightsLoading(false);
        setInsightError("");
      }
    },
    [
      useSystemPrompt,
      contextContent,
      autoTranscriptRollup,
      autoInterviewPerformance,
      saveContextSettings,
    ]
  );

  const updateAutoTranscriptRollup = useCallback(
    (value: boolean) => {
      setAutoTranscriptRollup(value);
      saveContextSettings(
        useSystemPrompt,
        contextContent,
        autoTranscriptInsights,
        value,
        autoInterviewPerformance
      );
      if (!value) {
        if (rollupAbortRef.current) {
          rollupAbortRef.current.abort();
          rollupAbortRef.current = null;
        }
        setRollupLoading(false);
        rollupInFlightRef.current = false;
      }
    },
    [
      useSystemPrompt,
      contextContent,
      autoTranscriptInsights,
      autoInterviewPerformance,
      saveContextSettings,
    ]
  );

  const updateAutoInterviewPerformance = useCallback(
    (value: boolean) => {
      setAutoInterviewPerformance(value);
      saveContextSettings(
        useSystemPrompt,
        contextContent,
        autoTranscriptInsights,
        autoTranscriptRollup,
        value
      );
      if (!value) {
        if (performanceAbortRef.current) {
          performanceAbortRef.current.abort();
          performanceAbortRef.current = null;
        }
        setPerformanceLoading(false);
        setPerformanceError("");
      }
    },
    [
      useSystemPrompt,
      contextContent,
      autoTranscriptInsights,
      autoTranscriptRollup,
      saveContextSettings,
    ]
  );

  // Quick actions management
  const saveQuickActions = useCallback((actions: string[]) => {
    try {
      safeLocalStorage.setItem(
        STORAGE_KEYS.SYSTEM_AUDIO_QUICK_ACTIONS,
        JSON.stringify(actions)
      );
    } catch (error) {
      console.error("Failed to save quick actions:", error);
    }
  }, []);

  const addQuickAction = useCallback(
    (action: string) => {
      if (action && !quickActions.includes(action)) {
        const newActions = [...quickActions, action];
        setQuickActions(newActions);
        saveQuickActions(newActions);
      }
    },
    [quickActions, saveQuickActions]
  );

  const removeQuickAction = useCallback(
    (action: string) => {
      const newActions = quickActions.filter((a) => a !== action);
      setQuickActions(newActions);
      saveQuickActions(newActions);
    },
    [quickActions, saveQuickActions]
  );

  const runTranscriptRollup = useCallback(async () => {
    if (!autoTranscriptRollup) return;
    if (setupRequiredRef.current) return;
    if (rollupInFlightRef.current) return;

    const entries = transcriptEntriesRef.current;
    const from = transcriptRollupThroughIndexRef.current;
    const endLen = entries.length;
    if (from >= endLen) return;

    const chunk = entries
      .slice(from, endLen)
      .map((e) => e.text)
      .join(" ")
      .trim();
    if (chunk.length < TRANSCRIPT_ROLLUP_MIN_CHARS) return;

    rollupInFlightRef.current = true;
    setRollupLoading(true);

    try {
      const useHostedAPI = await shouldUseHostedAPI();
      if (!selectedAIProvider.provider && !useHostedAPI) {
        return;
      }
      const provider = allAiProviders.find(
        (p) => p.id === selectedAIProvider.provider
      );
      if (!provider && !useHostedAPI) {
        return;
      }

      if (rollupAbortRef.current) {
        rollupAbortRef.current.abort();
      }
      const ctrl = new AbortController();
      rollupAbortRef.current = ctrl;

      const prev = transcriptRollupSummaryRef.current.trim();
      const userMessage =
        `Previous summary:\n${prev || "(none)"}\n\nNew verbatim transcript:\n${chunk}`;

      let raw = "";
      for await (const chunkOut of fetchAIResponse({
        provider: useHostedAPI ? undefined : provider,
        selectedProvider: selectedAIProvider,
        systemPrompt: TRANSCRIPT_ROLLUP_SYSTEM,
        history: [],
        userMessage,
        imagesBase64: [],
        signal: ctrl.signal,
        systemPromptOnly: true,
      })) {
        raw += chunkOut;
      }

      if (ctrl.signal.aborted) return;

      const merged = raw.trim();
      if (!merged) return;

      setTranscriptRollupSummary(merged);
      transcriptRollupSummaryRef.current = merged;
      transcriptRollupThroughIndexRef.current = endLen;
      setTranscriptRollupThroughIndex(endLen);
      lastInsightFingerprintRef.current = "";
    } catch (e: unknown) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      const err = e as { name?: string };
      if (err?.name === "AbortError") return;
      console.warn("[SystemAudio] Transcript rollup failed:", e);
    } finally {
      rollupInFlightRef.current = false;
      setRollupLoading(false);
    }
  }, [autoTranscriptRollup, selectedAIProvider, allAiProviders]);

  const runTranscriptInsightAnalysis = useCallback(async () => {
    if (!autoTranscriptInsights) return;
    if (setupRequiredRef.current) return;

    const entries = transcriptEntriesRef.current;
    const text = buildInsightTranscriptPayload(
      transcriptRollupSummaryRef.current,
      entries,
      transcriptRollupThroughIndexRef.current
    );
    if (text.length < TRANSCRIPT_INSIGHT_MIN_CHARS) return;
    if (text === lastInsightFingerprintRef.current) return;

    setInsightsLoading(true);
    setInsightError("");

    try {
      const useHostedAPI = await shouldUseHostedAPI();
      if (!selectedAIProvider.provider && !useHostedAPI) {
        return;
      }
      const provider = allAiProviders.find(
        (p) => p.id === selectedAIProvider.provider
      );
      if (!provider && !useHostedAPI) {
        return;
      }

      if (insightAbortRef.current) {
        insightAbortRef.current.abort();
      }
      const ctrl = new AbortController();
      insightAbortRef.current = ctrl;

      let raw = "";
      for await (const chunk of fetchAIResponse({
        provider: useHostedAPI ? undefined : provider,
        selectedProvider: selectedAIProvider,
        systemPrompt: TRANSCRIPT_INSIGHT_SYSTEM,
        history: [],
        userMessage: `Transcript:\n${text}`,
        imagesBase64: [],
        signal: ctrl.signal,
        systemPromptOnly: true,
      })) {
        raw += chunk;
      }

      if (ctrl.signal.aborted) return;

      const parsed = parseTranscriptInsightJson(raw);
      if (
        !parsed.summary &&
        parsed.questions.length === 0 &&
        raw.trim().length > 0
      ) {
        setInsightError("Could not parse insights");
      } else {
        setInsightError("");
      }
      setTranscriptInsight(parsed);
      lastInsightFingerprintRef.current = text;
    } catch (e: unknown) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      const err = e as { name?: string; message?: string };
      if (err?.name === "AbortError") return;
      setInsightError(err?.message || "Insight request failed");
    } finally {
      setInsightsLoading(false);
    }
  }, [autoTranscriptInsights, selectedAIProvider, allAiProviders]);

  const runInterviewPerformanceAnalysis = useCallback(async () => {
    if (!autoInterviewPerformance) return;
    if (setupRequiredRef.current) return;

    const entries = transcriptEntriesRef.current;
    const text = buildInsightTranscriptPayload(
      transcriptRollupSummaryRef.current,
      entries,
      transcriptRollupThroughIndexRef.current
    );
    if (text.length < INTERVIEW_PERFORMANCE_MIN_CHARS) return;
    if (text === lastPerformanceFingerprintRef.current) return;

    setPerformanceLoading(true);
    setPerformanceError("");

    try {
      const useHostedAPI = await shouldUseHostedAPI();
      if (!selectedAIProvider.provider && !useHostedAPI) {
        return;
      }
      const provider = allAiProviders.find(
        (p) => p.id === selectedAIProvider.provider
      );
      if (!provider && !useHostedAPI) {
        return;
      }

      if (performanceAbortRef.current) {
        performanceAbortRef.current.abort();
      }
      const ctrl = new AbortController();
      performanceAbortRef.current = ctrl;

      let raw = "";
      for await (const chunk of fetchAIResponse({
        provider: useHostedAPI ? undefined : provider,
        selectedProvider: selectedAIProvider,
        systemPrompt: INTERVIEW_PERFORMANCE_SYSTEM,
        history: [],
        userMessage: `Transcript:\n${text}`,
        imagesBase64: [],
        signal: ctrl.signal,
        systemPromptOnly: true,
      })) {
        raw += chunk;
      }

      if (ctrl.signal.aborted) return;

      const parsed = parseInterviewPerformanceJson(raw);
      if (!parsed) {
        if (raw.trim().length > 0) {
          setPerformanceError("Could not parse performance scores");
        }
      } else {
        setPerformanceError("");
        setInterviewPerformanceAI(parsed);
      }
      lastPerformanceFingerprintRef.current = text;
    } catch (e: unknown) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      const err = e as { name?: string; message?: string };
      if (err?.name === "AbortError") return;
      setPerformanceError(err?.message || "Performance request failed");
    } finally {
      setPerformanceLoading(false);
    }
  }, [autoInterviewPerformance, selectedAIProvider, allAiProviders]);

  const handleQuickActionClick = async (action: string) => {
    setError("");

    const transcript = buildTranscriptContextForPrompt(
      transcriptRollupSummaryRef.current,
      transcriptEntriesRef.current,
      transcriptRollupThroughIndexRef.current
    );
    const basePrompt = useSystemPrompt
      ? systemPrompt || DEFAULT_SYSTEM_PROMPT
      : contextContent || DEFAULT_SYSTEM_PROMPT;

    const interviewBlock = buildInterviewContextBlock(interviewOverrides);
    const audioStyle = buildSystemAudioAnswerStyleBlock();
    const conciseModeInstructions = buildConciseModeInstructions(conciseMode);
    const effectiveSystemPrompt = transcript
      ? `${basePrompt}${interviewBlock}${audioStyle}${conciseModeInstructions}\n\nBackground (what I heard—use as facts only; do not describe or quote this section in your reply):\n${transcript}`
      : `${basePrompt}${interviewBlock}${audioStyle}${conciseModeInstructions}`;

    const previousMessages = conversation.messages
      .filter((m) => m.role === "assistant")
      .map((msg) => ({ role: msg.role, content: msg.content }));

    await processWithAI(action, effectiveSystemPrompt, previousMessages);
  };

  // Generate AI response from transcript (always generate; ignore whether there are questions)
  const handleAnswerQuestions = async () => {
    setError("");

    const allEntries = transcriptEntriesRef.current;
    const fromIdx = lastAnsweredIndexRef.current;
    const rollupIdx = transcriptRollupThroughIndexRef.current;
    const start = Math.max(fromIdx, rollupIdx);
    const excerptEntries =
      start < allEntries.length ? allEntries.slice(start) : [];
    const excerptText = excerptEntries.map((e) => e.text).join(" ").trim();
    const summary = transcriptRollupSummaryRef.current.trim();

    if (!summary && !excerptText) return;

    const contextParts: string[] = [];
    if (summary) {
      contextParts.push(`Earlier meeting (rolled-up summary):\n${summary}`);
    }
    if (excerptText) {
      contextParts.push(
        `Recent transcript (since last answer, verbatim):\n${excerptText}`
      );
    }
    const transcriptText = contextParts.join("\n\n");

    const basePrompt = useSystemPrompt
      ? systemPrompt || DEFAULT_SYSTEM_PROMPT
      : contextContent || DEFAULT_SYSTEM_PROMPT;

    const interviewBlock = buildInterviewContextBlock(interviewOverrides);
    const audioStyle = buildSystemAudioAnswerStyleBlock();
    const conciseModeInstructions = buildConciseModeInstructions(conciseMode);
    const answerPrompt =
      `${basePrompt}${interviewBlock}${audioStyle}${conciseModeInstructions}\n\n` +
      `Background (what I heard—use only to know what to address; never describe or summarize this text in your answer):\n\n` +
      `${transcriptText}\n\n` +
      `Instructions:\n` +
      `- If there are interview-style questions, use **Q:** (short paraphrase) and **A:** (my answer in first person, as I would say it—no transcript meta).\n` +
      `- If there are no clear questions, still respond in first person as if I'm reflecting briefly in the interview (not as a narrator of the audio).\n` +
      `- Be concise (about 2–4 sentences per **A:** block). Always produce a response.\n`;

    const previousMessages = conversation.messages
      .filter((m) => m.role === "assistant")
      .map((msg) => ({ role: msg.role, content: msg.content }));

    await processWithAI(
      "Answer from the background notes as me in the interview.",
      answerPrompt,
      previousMessages
    );

    lastAnsweredIndexRef.current = allEntries.length;
    setLastAnsweredIndex(allEntries.length);
  };

  // Free-form user message: sends typed text to AI with transcript as context
  const handleUserMessage = async (userText: string) => {
    const trimmed = userText.trim();
    if (!trimmed) return;

    setError("");

    const basePrompt = useSystemPrompt
      ? systemPrompt || DEFAULT_SYSTEM_PROMPT
      : contextContent || DEFAULT_SYSTEM_PROMPT;

    const interviewBlock = buildInterviewContextBlock(interviewOverrides);
    const audioStyle = buildSystemAudioAnswerStyleBlock();
    const conciseModeInstructions = buildConciseModeInstructions(conciseMode);
    const transcriptText = buildTranscriptContextForPrompt(
      transcriptRollupSummaryRef.current,
      transcriptEntriesRef.current,
      transcriptRollupThroughIndexRef.current
    );
    const transcriptBlock = transcriptText
      ? `\n\nBackground (what I heard—facts only; do not describe this in your reply):\n${transcriptText}\n`
      : "";

    const prompt =
      `${basePrompt}${interviewBlock}${audioStyle}${conciseModeInstructions}${transcriptBlock}\n` +
      `Answer in first person as in a live interview. Be concise. No transcript or excerpt commentary.`;

    const previousMessages = conversation.messages
      .filter((m) => m.role === "assistant")
      .map((msg) => ({ role: msg.role, content: msg.content }));

    await processWithAI(trimmed, prompt, previousMessages);
  };

  const handleAnswerDetectedQuestion = async (question: string) => {
    const q = question.trim();
    if (!q) return;
    await handleUserMessage(
      `Answer this interview question as I would out loud. Question: ${q}`
    );
  };

  const handleCoachedAnswerRequest = async (
    mode: "full" | "points",
    snapshot: InterviewPerformanceSnapshot
  ) => {
    if (snapshot.source !== "ai") return;

    const fq = snapshot.focusQuestion?.trim() ?? "";
    const gaps = snapshot.gaps?.filter(Boolean) ?? [];
    const outline = snapshot.suggestedOutline?.filter(Boolean) ?? [];
    const draft = snapshot.optionalFullAnswer?.trim() ?? "";

    if (!fq && gaps.length === 0 && outline.length === 0 && !draft) return;

    const header =
      mode === "full"
        ? "[Performance coach → answer] Write what I should say out loud next, in first person. Aim for about 45–90 seconds when spoken. Ground every concrete claim in my resume, projects, and job description from context only; do not invent employers, dates, or metrics. If a detail is missing, say how I would phrase it without making up numbers."
        : "[Performance coach → talking points] Give 5–10 first-person bullets I can read out loud in a technical interview. Each bullet should be a speakable phrase or short sentence (not labels only): name the concept, tradeoff, or step; use correct technical terms; where useful add one clause on why it matters. Order bullets as a coherent answer I can deliver in order. Ground only in my resume, projects, and job description from context—no invented metrics, employers, or tools I did not use. No meta (“here are my points”); output bullets only.";

    const parts: string[] = [header];
    if (fq) {
      parts.push(`Primary question or prompt to address:\n${fq}`);
    }
    if (gaps.length) {
      parts.push(
        `Improve on these weaknesses in how I was coming across:\n${gaps
          .map((g) => `• ${g}`)
          .join("\n")}`
      );
    }
    if (outline.length) {
      parts.push(
        `Build from this outline (adapt into natural speech):\n${outline
          .map((o, i) => `${i + 1}. ${o}`)
          .join("\n")}`
      );
    }
    if (draft && mode === "full") {
      parts.push(
        `Optional draft from coach (refine for flow and grounding; fix anything that sounds unverifiable):\n${draft}`
      );
    }

    await handleUserMessage(parts.join("\n\n"));
  };

  // AI Processing function
  const processWithAI = useCallback(
    async (
      transcription: string,
      prompt: string,
      previousMessages: Message[],
      opts?: {
        imagesBase64?: string[];
        attachPendingScreenshot?: boolean;
        /** When true, system prompt is sent as-is (no duplicate interview merge in fetchAIResponse). */
        systemPromptOnly?: boolean;
      }
    ) => {
      if (insightAbortRef.current) {
        insightAbortRef.current.abort();
        insightAbortRef.current = null;
      }

      if (performanceAbortRef.current) {
        performanceAbortRef.current.abort();
        performanceAbortRef.current = null;
      }
      setPerformanceLoading(false);

      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }

      abortControllerRef.current = new AbortController();

      const attachPending = opts?.attachPendingScreenshot !== false;
      let imagesBase64: string[] = [];
      if (opts?.imagesBase64?.length) {
        imagesBase64 = [...opts.imagesBase64];
      } else if (attachPending && systemAudioScreenshotRef.current) {
        imagesBase64 = [systemAudioScreenshotRef.current];
      }

      const pendingSnapshot = systemAudioScreenshotRef.current;
      const pendingIncluded =
        !!pendingSnapshot && imagesBase64.includes(pendingSnapshot);

      try {
        setIsAIProcessing(true);
        setLastAIResponse("");
        setError("");

        let fullResponse = "";

        const useHostedAPI = await shouldUseHostedAPI();
        if (!selectedAIProvider.provider && !useHostedAPI) {
          setError("No AI provider selected.");
          return;
        }

        const provider = allAiProviders.find(
          (p) => p.id === selectedAIProvider.provider
        );
        if (!provider && !useHostedAPI) {
          setError("AI provider config not found.");
          return;
        }

        try {
          for await (const chunk of fetchAIResponse({
            provider: useHostedAPI ? undefined : provider,
            selectedProvider: selectedAIProvider,
            systemPrompt: prompt,
            history: previousMessages,
            userMessage: transcription,
            imagesBase64,
            systemPromptOnly: opts?.systemPromptOnly === true,
            interviewOverrides,
          })) {
            fullResponse += chunk;
            setLastAIResponse((prev) => prev + chunk);
          }
        } catch (aiError: any) {
          setError(aiError.message || "Failed to get AI response");
        }

        if (fullResponse) {
          const timestamp = Date.now();
          setConversation((prev) => ({
            ...prev,
            messages: [
              ...prev.messages,
              {
                id: generateMessageId("assistant", timestamp),
                role: "assistant" as const,
                content: fullResponse,
                timestamp,
              },
            ],
            updatedAt: timestamp,
            title: prev.title || generateConversationTitle(transcription),
          }));
          if (pendingIncluded) {
            setSystemAudioScreenshotBase64(null);
          }
        }
      } catch (err) {
        setError("Failed to get AI response");
      } finally {
        setIsAIProcessing(false);
        // No auto-restart - user manually controls when to start next recording
      }
    },
    [
      selectedAIProvider,
      allAiProviders,
      conversation.messages,
      interviewOverrides,
    ]
  );

  const analyzeSystemAudioScreenshot = useCallback(async () => {
    const img = systemAudioScreenshotRef.current;
    if (!img) return;

    // Match dashboard screenshot auto mode (useCompletion.handleScreenshotSubmit):
    // user message = Settings → Screenshot → auto prompt; system path = buildEnhancedSystemPrompt.
    const autoPrompt =
      screenshotConfiguration.autoPrompt?.trim() ||
      "Analyze this screenshot and provide insights";

    const transcriptText = buildTranscriptContextForPrompt(
      transcriptRollupSummaryRef.current,
      transcriptEntriesRef.current,
      transcriptRollupThroughIndexRef.current
    );
    const userMessage = transcriptText
      ? `${autoPrompt}\n\nBackground (what I heard—facts only):\n${transcriptText}`
      : autoPrompt;

    const baseSystemPrompt = systemPrompt?.trim() || "";

    const previousMessages = conversation.messages
      .filter((m) => m.role === "assistant")
      .map((msg) => ({ role: msg.role, content: msg.content }));

    setIsScreenshotAnalyzing(true);
    try {
      await processWithAI(userMessage, baseSystemPrompt, previousMessages, {
        imagesBase64: [img],
        attachPendingScreenshot: false,
      });
    } finally {
      setIsScreenshotAnalyzing(false);
    }
  }, [
    conversation.messages,
    systemPrompt,
    screenshotConfiguration.autoPrompt,
    processWithAI,
  ]);

  const startCapture = useCallback(async () => {
    try {
      setError("");
      setCaptureStatus("starting");
      setSpeechSegmentCount(0);
      setSystemAudioScreenshotBase64(null);
      console.log("[SystemAudio] Starting capture, mode:", vadConfig.enabled ? "VAD" : "streaming");

      const hasAccess = await invoke<boolean>("check_system_audio_access");
      if (!hasAccess) {
        setSetupRequired(true);
        setIsPopoverOpen(true);
        setCaptureStatus("idle");
        return;
      }

      const conversationId = generateConversationId("sysaudio");
      setConversation({
        id: conversationId,
        title: "",
        messages: [],
        createdAt: 0,
        updatedAt: 0,
      });
      setTranscriptEntries([]);
      transcriptEntriesRef.current = [];
      lastAnsweredIndexRef.current = 0;
      setLastAnsweredIndex(0);

      if (insightAbortRef.current) {
        insightAbortRef.current.abort();
        insightAbortRef.current = null;
      }
      setTranscriptInsight(null);
      setInsightError("");
      lastInsightFingerprintRef.current = "";
      setInsightsLoading(false);

      setTranscriptRollupSummary("");
      transcriptRollupSummaryRef.current = "";
      setTranscriptRollupThroughIndex(0);
      transcriptRollupThroughIndexRef.current = 0;
      if (rollupAbortRef.current) {
        rollupAbortRef.current.abort();
        rollupAbortRef.current = null;
      }
      setRollupLoading(false);
      rollupInFlightRef.current = false;

      if (performanceAbortRef.current) {
        performanceAbortRef.current.abort();
        performanceAbortRef.current = null;
      }
      setInterviewPerformanceAI(null);
      lastPerformanceFingerprintRef.current = "";
      setPerformanceLoading(false);
      setPerformanceError("");

      capturingRef.current = true;
      setCapturing(true);
      setPaused(false);
      setIsPopoverOpen(true);
      setRecordingProgress(0);

      // Stop any existing capture then start fresh
      try {
        await invoke<string>("stop_system_audio_capture");
      } catch {
        // Ignore errors from stopping non-existent capture
      }

      const deviceId =
        selectedAudioDevices.output.id !== "default"
          ? selectedAudioDevices.output.id
          : null;

      await invoke<string>("start_system_audio_capture", {
        vadConfig: vadConfig,
        deviceId: deviceId,
      });
    } catch (err) {
      capturingRef.current = false;
      const errorMessage = err instanceof Error ? err.message : String(err);
      console.error("[SystemAudio] startCapture error:", errorMessage);
      setError(errorMessage);
      setCaptureStatus("error");
      setIsPopoverOpen(true);
    }
  }, [vadConfig, selectedAudioDevices.output.id]);

  // Full stop: ends the session and closes the popover, but keeps transcript
  const stopCapture = useCallback(async () => {
    try {
      if (insightAbortRef.current) {
        insightAbortRef.current.abort();
        insightAbortRef.current = null;
      }
      setInsightsLoading(false);

      if (rollupAbortRef.current) {
        rollupAbortRef.current.abort();
        rollupAbortRef.current = null;
      }
      setRollupLoading(false);
      rollupInFlightRef.current = false;

      if (performanceAbortRef.current) {
        performanceAbortRef.current.abort();
        performanceAbortRef.current = null;
      }
      setPerformanceLoading(false);

      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }

      await invoke<string>("stop_system_audio_capture");

      capturingRef.current = false;

      setCapturing(false);
      setPaused(false);
      setIsProcessing(false);
      setRecordingProgress(0);
      setError("");
      setCaptureStatus("idle");
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      setError(`Failed to stop capture: ${errorMessage}`);
      console.error("[SystemAudio] Stop capture error:", err);
    }
  }, []);

  // Pause: stop the backend audio stream but preserve all transcript/AI data
  const pauseCapture = useCallback(async () => {
    try {
      await invoke<string>("stop_system_audio_capture");
      capturingRef.current = false;
      setPaused(true);
      setIsProcessing(false);
      setCaptureStatus("idle");
    } catch (err) {
      console.error("[SystemAudio] Pause error:", err);
    }
  }, []);

  // Resume: restart capture and continue appending to the existing transcript
  const resumeCapture = useCallback(async () => {
    try {
      setError("");
      setCaptureStatus("starting");
      setPaused(false);
      capturingRef.current = true;
      setCapturing(true);

      try {
        await invoke<string>("stop_system_audio_capture");
      } catch {
        // Ignore
      }

      const deviceId =
        selectedAudioDevices.output.id !== "default"
          ? selectedAudioDevices.output.id
          : null;

      await invoke<string>("start_system_audio_capture", {
        vadConfig: vadConfig,
        deviceId: deviceId,
      });
    } catch (err) {
      capturingRef.current = false;
      setCapturing(false);
      const errorMessage = err instanceof Error ? err.message : String(err);
      setError(errorMessage);
      setCaptureStatus("error");
    }
  }, [vadConfig, selectedAudioDevices.output.id]);

  const handleSetup = useCallback(async () => {
    try {
      const platform = navigator.platform.toLowerCase();

      if (platform.includes("mac") || platform.includes("win")) {
        await invoke("request_system_audio_access");
      }

      // Delay to give the user time to grant permissions in the system dialog.
      await new Promise((resolve) => setTimeout(resolve, 3000));

      const hasAccess = await invoke<boolean>("check_system_audio_access");
      if (hasAccess) {
        setSetupRequired(false);
        await startCapture();
      } else {
        setSetupRequired(true);
        setError("Permission not granted. Please try the manual steps.");
      }
    } catch (err) {
      setError("Failed to request access. Please try the manual steps below.");
      setSetupRequired(true);
    }
  }, [startCapture]);

  useEffect(() => {
    const shouldOpenPopover =
      capturing ||
      paused ||
      setupRequired ||
      isAIProcessing ||
      !!lastAIResponse ||
      !!error;
    setIsPopoverOpen(shouldOpenPopover);
    resizeWindow(shouldOpenPopover);
  }, [
    capturing,
    paused,
    setupRequired,
    isAIProcessing,
    lastAIResponse,
    error,
    resizeWindow,
  ]);

  useEffect(() => {
    globalShortcuts.registerSystemAudioCallback(async () => {
      if (capturing) {
        await pauseCapture();
      } else if (paused) {
        await resumeCapture();
      } else {
        await startCapture();
      }
    });
  }, [startCapture, pauseCapture, resumeCapture, capturing, paused]);

  useEffect(() => {
    return () => {
      if (insightAbortRef.current) {
        insightAbortRef.current.abort();
      }
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      invoke("stop_system_audio_capture").catch(() => {});
    };
  }, []);

  useEffect(() => {
    if (!autoTranscriptInsights) return;
    if (!capturing && !paused) return;

    const tick = () => {
      void runTranscriptInsightAnalysis();
    };

    const initial = window.setTimeout(tick, 2000);
    const id = window.setInterval(tick, TRANSCRIPT_INSIGHT_INTERVAL_MS);
    return () => {
      clearTimeout(initial);
      clearInterval(id);
    };
  }, [autoTranscriptInsights, capturing, paused, runTranscriptInsightAnalysis]);

  useEffect(() => {
    if (!autoInterviewPerformance) return;
    if (!capturing && !paused) return;

    const tick = () => {
      void runInterviewPerformanceAnalysis();
    };

    const initial = window.setTimeout(tick, 3500);
    const id = window.setInterval(tick, INTERVIEW_PERFORMANCE_INTERVAL_MS);
    return () => {
      clearTimeout(initial);
      clearInterval(id);
    };
  }, [
    autoInterviewPerformance,
    capturing,
    paused,
    runInterviewPerformanceAnalysis,
  ]);

  useEffect(() => {
    if (!autoTranscriptRollup) return;
    if (!capturing && !paused) return;

    const id = window.setInterval(() => {
      void runTranscriptRollup();
    }, TRANSCRIPT_ROLLUP_INTERVAL_MS);
    return () => clearInterval(id);
  }, [autoTranscriptRollup, capturing, paused, runTranscriptRollup]);

  // Debounced save to prevent race conditions and improve performance
  useEffect(() => {
    // Clear any pending save
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    // Only debounce if there are messages to save
    if (
      !conversation.id ||
      conversation.updatedAt === 0 ||
      conversation.messages.length === 0
    ) {
      return;
    }

    // Debounce saves (only save 500ms after last change)
    saveTimeoutRef.current = setTimeout(async () => {
      // Don't save if already saving (prevent concurrent saves)
      if (isSavingRef.current) {
        return;
      }

      try {
        isSavingRef.current = true;
        await saveConversation(conversation);
      } catch (error) {
        console.error("Failed to save system audio conversation:", error);
      } finally {
        isSavingRef.current = false;
      }
    }, CONVERSATION_SAVE_DEBOUNCE_MS);

    // Cleanup on unmount or dependency change
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, [
    conversation.messages.length,
    conversation.title,
    conversation.id,
    conversation.updatedAt,
  ]);

  const startNewConversation = useCallback(() => {
    setConversation({
      id: generateConversationId("sysaudio"),
      title: "",
      messages: [],
      createdAt: 0,
      updatedAt: 0,
    });
    setTranscriptEntries([]);
    transcriptEntriesRef.current = [];
    lastAnsweredIndexRef.current = 0;
    setLastAnsweredIndex(0);
    setLastTranscription("");
    setLastAIResponse("");
    setError("");
    setSetupRequired(false);
    setIsProcessing(false);
    setIsAIProcessing(false);
    setIsPopoverOpen(false);
    setUseSystemPrompt(true);
    if (insightAbortRef.current) {
      insightAbortRef.current.abort();
      insightAbortRef.current = null;
    }
    setTranscriptInsight(null);
    setInsightError("");
    lastInsightFingerprintRef.current = "";
    setInsightsLoading(false);
    setTranscriptRollupSummary("");
    transcriptRollupSummaryRef.current = "";
    setTranscriptRollupThroughIndex(0);
    transcriptRollupThroughIndexRef.current = 0;
    if (rollupAbortRef.current) {
      rollupAbortRef.current.abort();
      rollupAbortRef.current = null;
    }
    setRollupLoading(false);
    rollupInFlightRef.current = false;
    if (performanceAbortRef.current) {
      performanceAbortRef.current.abort();
      performanceAbortRef.current = null;
    }
    setInterviewPerformanceAI(null);
    lastPerformanceFingerprintRef.current = "";
    setPerformanceLoading(false);
    setPerformanceError("");
    setSystemAudioScreenshotBase64(null);
  }, []);

  // Update VAD configuration
  const updateVadConfiguration = useCallback(async (config: VadConfig) => {
    try {
      setVadConfig(config);
      safeLocalStorage.setItem("vad_config", JSON.stringify(config));
      await invoke("update_vad_config", { config });
    } catch (error) {
      console.error("Failed to update VAD config:", error);
    }
  }, []);

  const heuristicInterviewPerformance = useMemo(
    () => computeHeuristicInterviewPerformance(transcriptEntries),
    [transcriptEntries]
  );

  const interviewPerformance =
    interviewPerformanceAI ?? heuristicInterviewPerformance;

  // Keyboard arrow key support for scrolling
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isPopoverOpen) return;

      const scrollElement = scrollAreaRef.current?.querySelector(
        "[data-radix-scroll-area-viewport]"
      ) as HTMLElement;

      if (!scrollElement) return;

      const scrollAmount = 100; // pixels to scroll

      if (e.key === "ArrowDown") {
        e.preventDefault();
        scrollElement.scrollBy({ top: scrollAmount, behavior: "smooth" });
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        scrollElement.scrollBy({ top: -scrollAmount, behavior: "smooth" });
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isPopoverOpen]);

  return {
    capturing,
    paused,
    isProcessing,
    isAIProcessing,
    lastTranscription,
    lastAIResponse,
    error,
    setupRequired,
    startCapture,
    stopCapture,
    pauseCapture,
    resumeCapture,
    handleSetup,
    isPopoverOpen,
    setIsPopoverOpen,
    // Conversation management
    conversation,
    setConversation,
    transcriptEntries,
    // AI processing
    processWithAI,
    // Context management
    useSystemPrompt,
    setUseSystemPrompt: updateUseSystemPrompt,
    contextContent,
    setContextContent: updateContextContent,
    conciseMode,
    setConciseMode: updateConciseMode,
    startNewConversation,
    // Window resize
    resizeWindow,
    quickActions,
    addQuickAction,
    removeQuickAction,
    isManagingQuickActions,
    setIsManagingQuickActions,
    showQuickActions,
    setShowQuickActions,
    handleQuickActionClick,
    handleAnswerQuestions,
    handleUserMessage,
    handleAnswerDetectedQuestion,
    handleCoachedAnswerRequest,
    lastAnsweredIndex,
    autoTranscriptInsights,
    setAutoTranscriptInsights: updateAutoTranscriptInsights,
    transcriptInsight,
    insightsLoading,
    insightError,
    autoTranscriptRollup,
    setAutoTranscriptRollup: updateAutoTranscriptRollup,
    transcriptRollupSummary,
    transcriptRollupThroughIndex,
    rollupLoading,
    interviewPerformance,
    performanceLoading,
    performanceError,
    autoInterviewPerformance,
    setAutoInterviewPerformance: updateAutoInterviewPerformance,
    // VAD configuration
    vadConfig,
    updateVadConfiguration,
    // Streaming progress
    recordingProgress,
    // Scroll area ref for keyboard navigation
    scrollAreaRef,
    // Pipeline diagnostics
    captureStatus,
    speechSegmentCount,
    // Screenshot (shared with main input bar via custom event)
    systemAudioScreenshotBase64,
    attachSystemAudioScreenshot,
    removeSystemAudioScreenshot,
    analyzeSystemAudioScreenshot,
    isScreenshotAnalyzing,
  };
}

import { STORAGE_KEYS } from "@/config";
import { InterviewContext, InterviewType } from "@/types";

/** Projects longer than this (chars) are auto-summarized before being sent in prompts. */
export const PROJECTS_SUMMARY_THRESHOLD = 2000;

export interface InterviewTypeOption {
  id: InterviewType;
  label: string;
  description: string;
  prompt: string;
}

export const INTERVIEW_TYPES: InterviewTypeOption[] = [
  {
    id: "general",
    label: "General",
    description: "No specialized format — good for mixed or unknown rounds",
    prompt: "",
  },
  {
    id: "leetcode",
    label: "Leetcode / DSA Coding",
    description: "Data structures & algorithms whiteboard-style problems",
    prompt:
      "Answer style for coding/algorithm questions:\n" +
      "- Restate the problem and clarify constraints before solving.\n" +
      "- Walk through my approach step by step: brute force first, then optimize.\n" +
      "- State time and space complexity for each approach.\n" +
      "- Write clean, well-structured code with meaningful variable names.\n" +
      "- Dry-run the solution on an example before finalizing.\n" +
      "- If stuck, describe what I'm thinking and what I'd ask the interviewer.",
  },
  {
    id: "ml_coding",
    label: "ML Coding",
    description: "Implement ML algorithms, training loops, or data pipelines",
    prompt:
      "Answer style for ML implementation questions:\n" +
      "- Clarify the ML task, data format, and evaluation metric first.\n" +
      "- Explain my model/algorithm choice and why it fits.\n" +
      "- Write clean code: preprocessing, model definition, training loop, evaluation.\n" +
      "- Discuss trade-offs: model complexity vs. training time, precision vs. recall.\n" +
      "- Reference libraries (PyTorch, scikit-learn, etc.) with justification.\n" +
      "- Address edge cases: class imbalance, missing data, overfitting.",
  },
  {
    id: "ml_breadth",
    label: "ML Breadth / Concepts",
    description: "Conceptual ML questions across topics",
    prompt:
      "Answer style for ML concept questions:\n" +
      "- Give clear, concise explanations — intuition first, math only when it helps.\n" +
      "- Use concrete examples to illustrate abstract ideas.\n" +
      "- Compare related techniques (e.g., L1 vs L2, batch norm vs layer norm) with practical guidance.\n" +
      "- Focus on when and why I'd use each approach, not just definitions.\n" +
      "- Connect ideas across supervised, unsupervised, and deep learning when relevant.",
  },
  {
    id: "ml_case_study",
    label: "ML Case Study / System Design",
    description: "Design end-to-end ML systems for real-world problems",
    prompt:
      "Answer style for ML system design questions:\n" +
      "- Start by clarifying the business problem, success metrics, and constraints.\n" +
      "- Frame what I'm predicting and what data I need.\n" +
      "- Walk through the full pipeline: data → features → model → training → evaluation → deployment → monitoring.\n" +
      "- Discuss trade-offs at each stage (latency vs. accuracy, online vs. batch).\n" +
      "- Address scale, fairness/bias, and graceful degradation.\n" +
      "- Propose an iterative approach: baseline first, then improvements.",
  },
  {
    id: "sql_coding",
    label: "SQL Coding",
    description: "Write SQL queries for data analysis and manipulation",
    prompt:
      "Answer style for SQL questions:\n" +
      "- Clarify schema, table relationships, and expected output first.\n" +
      "- Start simple, then optimize (subquery → CTE → window function).\n" +
      "- Explain query logic step by step as I write it.\n" +
      "- Prefer CTEs for readability over deeply nested subqueries.\n" +
      "- Handle edge cases: NULLs, duplicates, empty tables, ranking ties.\n" +
      "- Discuss performance: indexes, partitions, avoiding full table scans.",
  },
  {
    id: "behavioral",
    label: "Behavioral",
    description: "STAR-format stories about leadership, conflict, teamwork",
    prompt:
      "Answer style for behavioral questions:\n" +
      "- Use STAR format: Situation, Task, Action, Result.\n" +
      "- Draw from real experiences in my resume and projects — specific names, numbers, outcomes.\n" +
      "- Keep each answer around 150-200 words (60-90 seconds of speaking).\n" +
      "- Emphasize my role and decisions, not just what the team did.\n" +
      "- End with a concrete result or lesson learned.\n" +
      "- Match the story to the competency being tested (leadership, conflict, failure, etc.).",
  },
  {
    id: "program_manager",
    label: "Program Manager",
    description: "Cross-functional coordination, planning, and execution",
    prompt:
      "Answer style for program manager questions:\n" +
      "- Start with the program goal, scope, and key stakeholders.\n" +
      "- Outline how I'd coordinate across teams and functions.\n" +
      "- Discuss planning: milestones, dependencies, resource allocation.\n" +
      "- Address risk management and mitigation strategies proactively.\n" +
      "- Use specific examples showing stakeholder alignment and communication.\n" +
      "- Highlight metrics I'd track to measure program health and success.\n" +
      "- Explain trade-offs between speed, quality, and scope.\n" +
      "- Show how I'd handle blockers, delays, and changing priorities.",
  },
  {
    id: "product_manager",
    label: "Product Manager",
    description: "Product strategy, user needs, and feature prioritization",
    prompt:
      "Answer style for product manager questions:\n" +
      "- Frame the problem from the user's perspective first.\n" +
      "- Define success metrics and how I'd measure them.\n" +
      "- Walk through discovery: research, user feedback, data analysis.\n" +
      "- Explain prioritization framework (impact vs. effort, user value).\n" +
      "- Discuss trade-offs between features, technical debt, and user needs.\n" +
      "- Show how I'd collaborate with engineering, design, and business stakeholders.\n" +
      "- Address go-to-market: launch strategy, adoption, iteration plan.\n" +
      "- Use concrete examples with real outcomes and learnings.",
  },
];

export const DEFAULT_INTERVIEW_CONTEXT: InterviewContext = {
  resume: "",
  projects: "",
  projectsSummary: "",
  jobDescription: "",
  enabled: true,
};

export type InterviewCustomPrompts = Partial<Record<InterviewType, string>>;

/**
 * When building prompts from React (main overlay), pass these from `useApp()` so the model
 * uses the same interview type / materials as the dashboard. Plain `localStorage` can be
 * stale across Tauri webview windows.
 */
export type InterviewPromptOverrides = {
  answerType?: InterviewType;
  customPrompts?: InterviewCustomPrompts;
  interviewContext?: InterviewContext;
};

function resolveInterviewPromptInputs(
  overrides?: InterviewPromptOverrides
): {
  answerType: InterviewType;
  customPrompts: InterviewCustomPrompts;
  ctx: InterviewContext;
} {
  return {
    answerType: overrides?.answerType ?? getInterviewAnswerType(),
    customPrompts: overrides?.customPrompts ?? getInterviewCustomPrompts(),
    ctx: overrides?.interviewContext
      ? { ...DEFAULT_INTERVIEW_CONTEXT, ...overrides.interviewContext }
      : getInterviewContext(),
  };
}

export const DEFAULT_INTERVIEW_ANSWER_TYPE: InterviewType = "general";

export const getInterviewCustomPrompts = (): InterviewCustomPrompts => {
  try {
    const stored = localStorage.getItem(STORAGE_KEYS.INTERVIEW_CUSTOM_PROMPTS);
    if (!stored) return {};
    return JSON.parse(stored);
  } catch {
    return {};
  }
};

export const setInterviewCustomPrompts = (
  prompts: InterviewCustomPrompts
): void => {
  localStorage.setItem(
    STORAGE_KEYS.INTERVIEW_CUSTOM_PROMPTS,
    JSON.stringify(prompts)
  );
};

export const getEffectivePrompt = (
  typeId: InterviewType,
  customPrompts: InterviewCustomPrompts
): string => {
  if (customPrompts[typeId] !== undefined) return customPrompts[typeId]!;
  return INTERVIEW_TYPES.find((t) => t.id === typeId)?.prompt ?? "";
};

export const getInterviewContext = (): InterviewContext => {
  try {
    const stored = localStorage.getItem(STORAGE_KEYS.INTERVIEW_CONTEXT);
    if (!stored) return DEFAULT_INTERVIEW_CONTEXT;
    return { ...DEFAULT_INTERVIEW_CONTEXT, ...JSON.parse(stored) };
  } catch {
    return DEFAULT_INTERVIEW_CONTEXT;
  }
};

export const setInterviewContext = (ctx: InterviewContext): void => {
  try {
    localStorage.setItem(STORAGE_KEYS.INTERVIEW_CONTEXT, JSON.stringify(ctx));
  } catch (error) {
    console.error("Error saving interview context:", error);
  }
};

export const updateInterviewContext = (
  partial: Partial<InterviewContext>
): InterviewContext => {
  const next = { ...getInterviewContext(), ...partial };
  setInterviewContext(next);
  return next;
};

const ATTUNE_INTERVIEW_SYNC = "attune-interview-sync";

/** Persist interview materials and notify other Tauri webviews (dashboard, overlay). */
export async function persistInterviewContext(
  partial: Partial<InterviewContext>
): Promise<InterviewContext> {
  const next = updateInterviewContext(partial);
  try {
    const { emit } = await import("@tauri-apps/api/event");
    await emit(ATTUNE_INTERVIEW_SYNC, { interviewContext: next });
  } catch {
    /* browser / non-tauri */
  }
  return next;
}

export function parseCoachingProjects(projectsText: string): string[] {
  if (!projectsText.trim()) return [];
  return projectsText
    .split(/\n+/)
    .map((line) => line.replace(/^[\s•\-*\d.)]+/, "").trim())
    .filter(Boolean);
}

export function formatCoachingProjects(projects: string[]): string {
  return projects.join("\n");
}

export function getCoachingFocusAreas(): string {
  try {
    return localStorage.getItem(STORAGE_KEYS.INTERVIEW_COACHING_FOCUS_AREAS) ?? "";
  } catch {
    return "";
  }
}

export function setCoachingFocusAreas(value: string): void {
  try {
    localStorage.setItem(STORAGE_KEYS.INTERVIEW_COACHING_FOCUS_AREAS, value);
  } catch (error) {
    console.error("Error saving coaching focus areas:", error);
  }
}

export const getInterviewAnswerType = (): InterviewType => {
  try {
    const stored = localStorage.getItem(STORAGE_KEYS.INTERVIEW_ANSWER_TYPE);
    if (!stored) return DEFAULT_INTERVIEW_ANSWER_TYPE;
    const parsed = JSON.parse(stored);
    if (INTERVIEW_TYPES.some((t) => t.id === parsed)) return parsed;
    return DEFAULT_INTERVIEW_ANSWER_TYPE;
  } catch {
    return DEFAULT_INTERVIEW_ANSWER_TYPE;
  }
};

export function buildFirstPersonInstruction(): string {
  if (!getInterviewContext().enabled) return "";
  return "";
}

/** Light framing before interview-type and context blocks; type-specific prompts carry detail. */
export const INTERVIEW_RESPONSE_PREAMBLE =
  "You are an expert in technical and ML interviews. The user is in an interview setting. " +
  "When the interview-type instructions below conflict with this, follow those instructions.";

/**
 * Preamble plus Dashboard "Interview type" instructions (custom or default).
 * Use when the full `buildInterviewContextBlock()` is empty so vision/screenshot flows still get answer shaping.
 */
export function buildInterviewTypeAndRulesBlock(
  overrides?: InterviewPromptOverrides
): string {
  const { answerType, customPrompts } = resolveInterviewPromptInputs(overrides);
  const effectivePrompt = getEffectivePrompt(answerType, customPrompts);
  let block = "\n\n" + INTERVIEW_RESPONSE_PREAMBLE;
  if (effectivePrompt) {
    block += "\n\n" + effectivePrompt;
  }
  return block;
}

export function buildInterviewContextBlock(
  overrides?: InterviewPromptOverrides
): string {
  const { answerType, customPrompts, ctx } = resolveInterviewPromptInputs(overrides);

  const sections: string[] = [];

  if (ctx.enabled) {
    if (ctx.resume.trim()) {
      sections.push(`## My Resume\n${ctx.resume.trim()}`);
    }
    if (ctx.projects.trim()) {
      const useSummary =
        ctx.projectsSummary.trim() &&
        ctx.projects.trim().length > PROJECTS_SUMMARY_THRESHOLD;
      const projectsText = useSummary
        ? ctx.projectsSummary.trim()
        : ctx.projects.trim();
      sections.push(`## My Projects\n${projectsText}`);
    }
    if (ctx.jobDescription.trim()) {
      sections.push(`## Job Description\n${ctx.jobDescription.trim()}`);
    }
  }

  const effectivePrompt = getEffectivePrompt(answerType, customPrompts);

  if (sections.length === 0 && !effectivePrompt) return "";

  let block = "\n\n" + INTERVIEW_RESPONSE_PREAMBLE;

  if (effectivePrompt) {
    block += "\n\n" + effectivePrompt;
  }

  if (sections.length > 0) {
    block += "\n\n" + sections.join("\n\n");
  }

  return block;
}

/** Appended to system audio AI calls so answers stay first-person and interview-like even when interview context is off. */
export function buildSystemAudioAnswerStyleBlock(): string {
  return (
    "\n\n---\nSystem audio — how to answer:\n" +
    "• Always first person (I, me, my). Never \"the candidate\", \"you\" for me, or third-person about me.\n" +
    "• I am in an interview; reply as I would speak out loud to the interviewer.\n" +
    "• Do NOT describe or summarize the transcript, excerpt, summary, or audio " +
    '(no "the excerpt discusses", "based on the transcript", "the audio indicates", "they said", "the speaker").\n' +
    "• No meta framing: avoid \"In summary\", \"This segment\", \"The question seems to be\", \"It sounds like\".\n" +
    "• Use background text only as silent facts; output only my direct answer content.\n"
  );
}

/** Adds concise mode formatting instructions when enabled. */
export function buildConciseModeInstructions(conciseMode: boolean): string {
  if (!conciseMode) return "";
  
  return (
    "\n\n---\nCONCISE MODE — Format your response:\n" +
    "• Structure your answer as clear bullet points or numbered points.\n" +
    "• Each point should have: **Brief heading or key point** followed by 1-2 sentences of detail.\n" +
    "• Use this format: **Key Point**: Supporting detail or explanation.\n" +
    "• Example:\n" +
    "  - **Technical Approach**: Brief explanation of the method.\n" +
    "  - **Trade-offs**: Quick note on pros/cons.\n" +
    "• Keep each bullet concise but complete enough to understand without expansion.\n" +
    "• Aim for 3-6 well-structured points rather than long paragraphs.\n"
  );
}

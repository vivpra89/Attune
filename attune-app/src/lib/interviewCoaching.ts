import { InterviewType, InterviewQuestion, CoachingFeedback, TargetCompany } from "@/pages/app/components/speech/InterviewCoachingMode";

export interface GenerateQuestionsParams {
  type: InterviewType;
  resume: string;
  jobDescription: string;
  projects: string[];
  targetCompany?: TargetCompany;
  count?: number;
  difficultyFocus?: "mixed" | "easy" | "medium" | "hard" | "adaptive";
  /** Question texts to avoid when regenerating a fresh set */
  previousQuestions?: string[];
  /** Free-text topics or skills the candidate wants questioned */
  questionFocusAreas?: string;
}

export interface EvaluateAnswerParams {
  question: InterviewQuestion;
  answer: string;
  interviewType: InterviewType;
  targetCompany?: TargetCompany;
  resume?: string;
  jobDescription?: string;
}

/**
 * Generate personalized interview questions using AI
 */
export async function generateInterviewQuestions(
  params: GenerateQuestionsParams
): Promise<InterviewQuestion[]> {
  const {
    type,
    resume,
    jobDescription,
    projects,
    targetCompany = "generic",
    count = 5,
    difficultyFocus = "mixed",
    previousQuestions = [],
    questionFocusAreas = "",
  } = params;

  const systemPrompt = buildQuestionGenerationPrompt(
    type,
    resume,
    jobDescription,
    projects,
    count,
    targetCompany,
    difficultyFocus,
    previousQuestions,
    questionFocusAreas
  );
  const userMessage = buildQuestionGenerationUserMessage(
    resume,
    jobDescription,
    projects,
    count,
    previousQuestions,
    questionFocusAreas
  );

  try {
    const response = await fetchAICompletion(systemPrompt, userMessage);
    const questions = parseQuestionsFromResponse(response);
    return questions;
  } catch (error) {
    console.error("Failed to generate interview questions:", error);
    throw new Error(
      error instanceof Error ? error.message : "Failed to generate interview questions"
    );
  }
}

/**
 * Evaluate an interview answer and provide FAANG-level coaching
 */
export async function evaluateInterviewAnswer(
  params: EvaluateAnswerParams
): Promise<CoachingFeedback> {
  const { question, answer, interviewType, targetCompany = "generic", resume, jobDescription } = params;

  const systemPrompt = buildCoachingPrompt(
    question,
    answer,
    interviewType,
    resume,
    jobDescription,
    targetCompany
  );

  try {
    const response = await fetchAICompletion(systemPrompt, "Evaluate answer");

    // Parse coaching feedback
    const feedback = parseCoachingFeedback(response);
    return feedback;
  } catch (error) {
    console.error("Failed to evaluate answer:", error);
    throw new Error("Failed to get coaching feedback. Please try again.");
  }
}

/**
 * Build system prompt for question generation
 */
const COMPANY_INTERVIEW_STYLES: Record<string, string> = {
  amazon: `You are interviewing specifically for Amazon. Every behavioral/PM/PgM question MUST map to one of Amazon's 16 Leadership Principles. Include a "leadershipPrinciple" field in each question JSON. Amazon interviews focus on: data-driven decisions, customer obsession, ownership mentality, and "disagree and commit." Questions should probe for specific metrics, mechanisms, and the candidate's unique contribution.`,
  google: `You are interviewing specifically for Google. Google values structured thinking, "Googleyness" (intellectual humility, collaboration, conscientiousness), and hypothesis-driven approaches. Questions should test analytical rigor, ability to break down ambiguous problems, and cross-functional collaboration.`,
  meta: `You are interviewing specifically for Meta. Meta interviews emphasize product sense, metrics-driven thinking, "move fast" mentality, and impact at scale. PM questions should include "How would you improve X?" format. Focus on user empathy, A/B testing mindset, and shipping velocity.`,
  apple: `You are interviewing specifically for Apple. Apple values design thinking, attention to detail, end-to-end user experience, and deep craftsmanship. Questions should probe for taste, design trade-offs, and how candidates balance simplicity with functionality.`,
  netflix: `You are interviewing specifically for Netflix. Netflix culture emphasizes freedom and responsibility, high performance, radical candor, and context over control. Questions should test independent judgment, courage to make tough calls, and ability to thrive with minimal process.`,
  microsoft: `You are interviewing specifically for Microsoft. Microsoft values growth mindset, inclusive collaboration, and customer-focused innovation. Questions should test adaptability, empathy, learning from failure, and ability to drive impact across large organizations.`,
  generic: `You are a senior FAANG interviewer (Google, Meta, Amazon, Apple, Netflix).`,
};

function buildQuestionGenerationUserMessage(
  resume: string,
  jobDescription: string,
  projects: string[],
  count: number,
  previousQuestions: string[],
  questionFocusAreas: string
): string {
  const parts: string[] = [
    `Generate exactly ${count} interview questions as a JSON array.`,
  ];

  if (resume.trim()) {
    parts.push(`**Candidate resume / background (personalize questions to this):**\n${resume.trim()}`);
  }
  if (jobDescription.trim()) {
    parts.push(`**Target job description (align questions to this role):**\n${jobDescription.trim()}`);
  }
  if (projects.length > 0) {
    parts.push(
      `**Key projects to reference:**\n${projects.map((p, i) => `${i + 1}. ${p}`).join("\n")}`
    );
  }
  if (questionFocusAreas.trim()) {
    parts.push(
      `**Topics and areas the candidate wants to be questioned on (prioritize these):**\n${questionFocusAreas.trim()}`
    );
  }

  if (previousQuestions.length > 0) {
    parts.push(
      `**Do NOT repeat or lightly rephrase these questions — generate a completely different set:**\n${previousQuestions
        .map((q, i) => `${i + 1}. ${q}`)
        .join("\n")}`
    );
    parts.push(
      "New questions must still be grounded in the resume and job description above, but cover different skills, projects, scenarios, and topics."
    );
  } else if (resume.trim() || jobDescription.trim() || questionFocusAreas.trim()) {
    parts.push(
      "Each question must cite or probe specific details from the resume, job description, or focus areas above. Avoid generic textbook questions."
    );
  }

  return parts.join("\n\n");
}

function buildQuestionGenerationPrompt(
  type: InterviewType,
  resume: string,
  jobDescription: string,
  projects: string[],
  count: number,
  targetCompany: TargetCompany,
  difficultyFocus: string,
  previousQuestions: string[],
  questionFocusAreas: string
): string {
  const typeDescriptions = {
    technical: "deep technical knowledge, problem-solving, and system understanding",
    behavioral: "leadership, teamwork, conflict resolution, and past experiences using STAR method",
    system_design: "scalability, architecture, trade-offs, and distributed systems",
    coding: "algorithms, data structures, complexity analysis, and code optimization",
    product_management: "product strategy, roadmapping, stakeholder management, metrics-driven decisions, user empathy, and execution",
    program_management: "cross-functional coordination, risk management, stakeholder alignment, delivery timelines, and resource optimization",
    general: "a mix of technical skills, behavioral scenarios, and problem-solving",
  };

  const contextParts = [];
  if (resume.trim()) contextParts.push(`**Candidate Resume/Background:**\n${resume.trim()}\n`);
  if (jobDescription.trim()) contextParts.push(`**Target Job Description:**\n${jobDescription.trim()}\n`);
  if (projects.length > 0) contextParts.push(`**Key Projects:**\n${projects.map((p, i) => `${i + 1}. ${p}`).join("\n")}\n`);
  if (questionFocusAreas.trim()) {
    contextParts.push(
      `**Candidate-Requested Focus Areas (weight heavily — spread questions across these topics):**\n${questionFocusAreas.trim()}\n`
    );
  }

  const focusRules = questionFocusAreas.trim()
    ? ` At least ${Math.min(count, Math.max(2, Math.ceil(count * 0.6)))} questions must directly target the candidate-requested focus areas above.`
    : "";

  const personalizationRules =
    resume.trim() || jobDescription.trim() || questionFocusAreas.trim()
      ? `6. **Personalization is mandatory:** At least ${Math.max(3, Math.ceil(count * 0.8))} of ${count} questions must explicitly reference specific details from the resume, job description, listed projects, or requested focus areas (e.g. named technologies, employers, responsibilities, metrics, or role requirements). Do not output generic questions that could apply to any candidate.${focusRules}`
      : `6. Resume and job description were not provided — generate strong FAANG-style questions for the interview type, but note they will be less role-specific.`;

  const avoidPrevious =
    previousQuestions.length > 0
      ? `\n7. **Fresh set required:** The candidate rejected the previous question set. Do not reuse, paraphrase, or ask the same scenario as:\n${previousQuestions.map((q, i) => `   ${i + 1}. ${q}`).join("\n")}`
      : "";

  const companyContext = COMPANY_INTERVIEW_STYLES[targetCompany] || COMPANY_INTERVIEW_STYLES.generic;

  const difficultyInstruction = difficultyFocus === "mixed"
    ? "Progress from easier to harder difficulty."
    : difficultyFocus === "adaptive"
      ? "Mix difficulties but lean toward medium-hard to challenge the candidate."
      : `All questions should be ${difficultyFocus} difficulty.`;

  const lpField = targetCompany === "amazon"
    ? `\n    "leadershipPrinciple": "The Amazon LP this question maps to"`
    : "";

  return `${companyContext} Generate ${count} high-quality interview questions for a ${type} interview.

${contextParts.join("\n")}

Generate ${count} questions that:
1. Are appropriate for FAANG-level interviews${targetCompany !== "generic" ? ` at ${targetCompany.charAt(0).toUpperCase() + targetCompany.slice(1)}` : ""}
2. Focus on ${typeDescriptions[type]}
3. Are personalized based on the candidate's background and target role
4. ${difficultyInstruction}
5. Cover different aspects of ${type} interviews
${personalizationRules}${avoidPrevious}

For each question, provide:
- The question text
- Context or scenario (if applicable)
- Difficulty level (easy, medium, hard)
- Category/topic
- 2-3 key points an ideal answer should cover${targetCompany === "amazon" ? "\n- The Amazon Leadership Principle this question maps to" : ""}

Format your response as JSON array:
\`\`\`json
[
  {
    "question": "Question text here",
    "context": "Optional context or scenario",
    "difficulty": "medium",
    "category": "Category name",
    "expectedKeyPoints": [
      "First key point",
      "Second key point"
    ]${lpField}
  }
]
\`\`\`

Make questions specific, relevant, and challenging. Avoid generic questions that ignore the resume and job description when those are provided.`;
}

/** Delimiter between JSON feedback and level-specific model answers */
export const FAANG_MODEL_ANSWER_DELIMITER = "===FAANG_MODEL_ANSWER===";
export const FAANG_MODEL_ANSWER_L4_DELIMITER = "===FAANG_MODEL_ANSWER_L4===";
export const FAANG_MODEL_ANSWER_L5_DELIMITER = "===FAANG_MODEL_ANSWER_L5===";
export const FAANG_MODEL_ANSWER_L6_DELIMITER = "===FAANG_MODEL_ANSWER_L6===";

export type InterviewLevel = "L4" | "L5" | "L6";

export const INTERVIEW_LEVELS: InterviewLevel[] = ["L4", "L5", "L6"];

export const INTERVIEW_LEVEL_GUIDE: Record<
  InterviewLevel,
  { label: string; title: string; description: string }
> = {
  L4: {
    label: "L4",
    title: "Mid-level IC",
    description:
      "Competent individual contributor — clear structure, correct technical depth, executes independently on scoped work.",
  },
  L5: {
    label: "L5",
    title: "Senior IC",
    description:
      "Senior scope — drives design decisions, mentors others, quantifies impact across a team or feature area, handles trade-offs.",
  },
  L6: {
    label: "L6",
    title: "Staff+",
    description:
      "Org-level impact — sets direction across teams, handles ambiguity, influences strategy, and connects work to business outcomes.",
  },
};

function cleanModelAnswerMarkdown(text: string): string {
  return text
    .trim()
    .replace(/^```(?:markdown|md)?\s*/i, "")
    .replace(/\s*```\s*$/, "")
    .trim();
}

function extractDelimitedSection(
  text: string,
  startDelimiter: string,
  endDelimiters: string[]
): string {
  const start = text.indexOf(startDelimiter);
  if (start < 0) return "";

  const contentStart = start + startDelimiter.length;
  let end = text.length;
  for (const delimiter of endDelimiters) {
    const idx = text.indexOf(delimiter, contentStart);
    if (idx >= 0 && idx < end) end = idx;
  }

  return cleanModelAnswerMarkdown(text.slice(contentStart, end));
}

/** Parse L4/L5/L6 model answers from delimiter format (supports legacy single-delimiter L5). */
export function parseLevelModelAnswers(rawSection: string): Partial<Record<InterviewLevel, string>> {
  const text = rawSection.trim();
  if (!text) return {};

  const hasLevelDelimiters =
    text.includes(FAANG_MODEL_ANSWER_L4_DELIMITER) ||
    text.includes(FAANG_MODEL_ANSWER_L5_DELIMITER) ||
    text.includes(FAANG_MODEL_ANSWER_L6_DELIMITER);

  if (!hasLevelDelimiters) {
    const legacy = cleanModelAnswerMarkdown(text);
    return legacy ? { L5: legacy } : {};
  }

  const l4 = extractDelimitedSection(text, FAANG_MODEL_ANSWER_L4_DELIMITER, [
    FAANG_MODEL_ANSWER_L5_DELIMITER,
    FAANG_MODEL_ANSWER_L6_DELIMITER,
  ]);
  const l5 = extractDelimitedSection(text, FAANG_MODEL_ANSWER_L5_DELIMITER, [
    FAANG_MODEL_ANSWER_L6_DELIMITER,
  ]);
  const l6 = extractDelimitedSection(text, FAANG_MODEL_ANSWER_L6_DELIMITER, []);

  const levelAnswers: Partial<Record<InterviewLevel, string>> = {};
  if (l4) levelAnswers.L4 = l4;
  if (l5) levelAnswers.L5 = l5;
  if (l6) levelAnswers.L6 = l6;
  return levelAnswers;
}

export function resolveCoachingLevelAnswers(
  feedback: Pick<CoachingFeedback, "suggestedAnswer" | "levelAnswers">
): Partial<Record<InterviewLevel, string>> {
  if (feedback.levelAnswers) {
    const hasAny = INTERVIEW_LEVELS.some((level) => feedback.levelAnswers?.[level]?.trim());
    if (hasAny) return feedback.levelAnswers;
  }
  if (feedback.suggestedAnswer?.trim()) {
    return { L5: feedback.suggestedAnswer.trim() };
  }
  return {};
}

export function buildCoachingOutputFormatInstructions(): string {
  return `
**OUTPUT FORMAT (required):**
1. Output ONE valid JSON object with score, strengths, improvements, faangComparison, nextSteps, followUpQuestions, etc.
2. In JSON, set "suggestedAnswer" to "" (empty string) — do NOT put model answers inside JSON.
3. Immediately after the JSON (after the closing \`}\`), output THREE level-specific model answers using these exact delimiter lines in order:
   ${FAANG_MODEL_ANSWER_L4_DELIMITER}
   (L4 mid-level IC answer — markdown)
   ${FAANG_MODEL_ANSWER_L5_DELIMITER}
   (L5 senior IC answer — markdown)
   ${FAANG_MODEL_ANSWER_L6_DELIMITER}
   (L6 staff+ answer — markdown)
4. Each level answer must be a complete spoken interview response in markdown. No JSON escaping needed.`;
}

/** Instructions for generating a full FAANG-level model answer in coaching JSON */
export function buildSuggestedAnswerInstructions(type: InterviewType | string): string {
  const frameworks: Record<string, string> = {
    behavioral: `Structure with markdown headers: ## Situation, ## Task, ## Action, ## Result. Action must be the longest section with "I" statements. Result must include 2+ quantified outcomes (%, revenue, time saved, users, NPS, etc.).`,
    technical: `Structure with markdown headers: ## Clarify & Restate, ## Approach, ## Technical Deep-Dive, ## Trade-offs & Alternatives. Include specific technologies, complexity, and why you chose this approach over alternatives.`,
    system_design: `Structure with markdown headers: ## Requirements (functional + non-functional with scale numbers), ## High-Level Design (components + data flow), ## Deep-Dive (2-3 critical components), ## Scaling & Bottlenecks, ## Trade-offs. Include capacity estimates, APIs, storage choices, and failure modes.`,
    coding: `Structure with markdown headers: ## Problem Understanding, ## Approach (brute force then optimal), ## Solution Walkthrough, ## Complexity Analysis, ## Edge Cases & Testing. Include pseudocode or clear algorithm steps and Big-O.`,
    product_management: `Structure with markdown headers: ## Clarify (users, goals, constraints), ## Framework, ## Analysis (metrics, data, trade-offs), ## Recommendation, ## Success Metrics & Rollout. Include prioritization rationale and north-star metrics.`,
    program_management: `Structure with markdown headers: ## Context & Scope, ## Stakeholders, ## Plan & Execution, ## Risks & Mitigations, ## Outcome & Learnings. Include timeline, dependencies, and how you drove alignment.`,
    general: `Structure with markdown headers: ## Opening Hook, ## Context, ## Core Answer, ## Evidence & Examples, ## Wrap-up. Cover all expected key points explicitly.`,
  };

  const lengthGuide: Record<string, string> = {
    behavioral: "500–800 words (2–3 minute spoken answer)",
    technical: "500–700 words",
    system_design: "900–1200 words (full design interview depth)",
    coding: "500–700 words",
    product_management: "600–900 words",
    program_management: "600–900 words",
    general: "500–700 words",
  };

  const framework = frameworks[type] || frameworks.general;
  const length = lengthGuide[type] || lengthGuide.general;

  return `
**CRITICAL — Level-specific model answers (L4 / L5 / L6):**
Write THREE distinct complete answers after the delimiter lines. Each must address the same question but reflect what a strong candidate at that level would say. The user uses these to compare depth, scope, and impact across levels.

Level expectations:
- **L4 (Mid-level IC):** Shorter (~250–450 words). Correct structure, solid execution, 1–2 metrics, focused on *your* individual contribution. Avoid org-wide strategy.
- **L5 (Senior IC):** ${length}. Drives technical/product decisions, mentors others, multiple metrics, explicit trade-offs, cross-functional collaboration, end-to-end ownership of a significant area.
- **L6 (Staff+):** Longer (~700–1000 words). Org or multi-team scope, strategy and principles, ambiguity, influence without authority, connects to business outcomes and long-term bets.

Shared requirements for all three levels:
- ${framework}
- Address EVERY item under "Expected Key Points" — depth and scope should differ by level, not the topics skipped.
- Write in first person, conversational interview tone, as if speaking aloud.
- Use markdown (## headers, bullets only where listing metrics or steps).
- Do NOT truncate with "...", "e.g.", or placeholder text.
- Make the difference between levels obvious: L4 = competent IC, L5 = senior scope + leadership, L6 = staff-level systems/strategy thinking.`;
}

function extractBalancedJsonObject(text: string): string | null {
  const start = text.indexOf("{");
  if (start < 0) return null;

  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (inString) {
      if (c === "\\") escape = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') {
      inString = true;
      continue;
    }
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

/** Remove inline suggestedAnswer when multiline markdown broke JSON.parse */
function stripInlineSuggestedAnswer(jsonLike: string): string {
  const key = '"suggestedAnswer"';
  const idx = jsonLike.indexOf(key);
  if (idx < 0) return jsonLike;

  const rest = jsonLike.slice(idx);
  const nextField = rest.search(
    /,\s*"(?:nextSteps|followUpQuestions|companySpecificNotes|faangComparison|improvements|strengths)"/
  );
  if (nextField < 0) return jsonLike;

  return `${jsonLike.slice(0, idx)}"suggestedAnswer": ""${rest.slice(nextField)}`;
}

function tryParseJsonObject(text: string): Record<string, unknown> | null {
  let s = text.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (fence) s = fence[1].trim();

  const balanced = extractBalancedJsonObject(s);
  const stripped = stripInlineSuggestedAnswer(s);
  const strippedBalanced = balanced ? stripInlineSuggestedAnswer(balanced) : null;

  const candidates = [s, balanced, stripped, strippedBalanced].filter(
    (x): x is string => Boolean(x)
  );

  const unique = [...new Set(candidates)];

  for (const candidate of unique) {
    try {
      return JSON.parse(candidate) as Record<string, unknown>;
    } catch {
      try {
        return JSON.parse(candidate.replace(/,\s*([}\]])/g, "$1")) as Record<string, unknown>;
      } catch {
        /* try next candidate */
      }
    }
  }
  return null;
}

function normalizeCoachingPayload(
  parsed: Record<string, unknown>,
  modelAnswerFromDelimiter: string
): CoachingFeedback {
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  const arr = (v: unknown) =>
    Array.isArray(v) ? (v.filter((x) => typeof x === "string") as string[]) : [];

  const suggestedFromJson = str(parsed.suggestedAnswer);
  const levelAnswers = parseLevelModelAnswers(modelAnswerFromDelimiter);
  const legacyAnswer = Object.keys(levelAnswers).length === 0
    ? cleanModelAnswerMarkdown(modelAnswerFromDelimiter || suggestedFromJson)
    : "";
  if (legacyAnswer && !levelAnswers.L5) {
    levelAnswers.L5 = legacyAnswer;
  }

  const suggestedAnswer = levelAnswers.L5 || legacyAnswer || undefined;

  return {
    score: Math.min(100, Math.max(0, Number(parsed.score) || 50)),
    strengths: arr(parsed.strengths),
    improvements: arr(parsed.improvements),
    faangComparison: str(parsed.faangComparison),
    suggestedAnswer,
    levelAnswers: Object.keys(levelAnswers).length > 0 ? levelAnswers : undefined,
    nextSteps: arr(parsed.nextSteps),
    followUpQuestions: arr(parsed.followUpQuestions),
    companySpecificNotes: str(parsed.companySpecificNotes) || undefined,
  };
}

/** Parse coaching feedback — supports delimiter format and legacy inline JSON */
export function parseCoachingFromResponse(raw: string): CoachingFeedback {
  const trimmed = raw.trim();
  let jsonSection = trimmed;
  let modelAnswerExtra = "";

  const levelDelimIdx = [
    FAANG_MODEL_ANSWER_L4_DELIMITER,
    FAANG_MODEL_ANSWER_L5_DELIMITER,
    FAANG_MODEL_ANSWER_L6_DELIMITER,
    FAANG_MODEL_ANSWER_DELIMITER,
  ]
    .map((delimiter) => trimmed.indexOf(delimiter))
    .filter((idx) => idx >= 0)
    .sort((a, b) => a - b)[0];

  if (levelDelimIdx !== undefined) {
    jsonSection = trimmed.slice(0, levelDelimIdx).trim();
    modelAnswerExtra = trimmed.slice(levelDelimIdx).trim();
  }

  const parsed = tryParseJsonObject(jsonSection);
  if (parsed) {
    return normalizeCoachingPayload(parsed, modelAnswerExtra);
  }

  const parsedWhole = tryParseJsonObject(trimmed);
  if (parsedWhole) {
    return normalizeCoachingPayload(parsedWhole, "");
  }

  console.error("[InterviewCoaching] Failed to parse feedback:", trimmed.slice(0, 800));
  throw new Error("Could not parse AI coaching feedback. Please try again.");
}

/**
 * Build system prompt for coaching feedback
 */
function buildCoachingPrompt(
  question: InterviewQuestion,
  answer: string,
  type: InterviewType,
  resume?: string,
  jobDescription?: string,
  targetCompany: TargetCompany = "generic"
): string {
  const evaluationCriteria = {
    technical: [
      "Technical accuracy and depth",
      "Problem-solving approach",
      "Communication of complex concepts",
      "Consideration of edge cases",
      "Code quality and best practices"
    ],
    behavioral: [
      "Use of STAR method (Situation, Task, Action, Result)",
      "Leadership and impact demonstrated",
      "Self-awareness and learning from experiences",
      "Collaboration and communication skills",
      "Specific, quantifiable results"
    ],
    system_design: [
      "Understanding of system requirements",
      "Scalability and performance considerations",
      "Trade-off analysis",
      "Component design and interactions",
      "Operational considerations (monitoring, deployment, etc.)"
    ],
    coding: [
      "Algorithm correctness and efficiency",
      "Time and space complexity analysis",
      "Code clarity and structure",
      "Edge case handling",
      "Optimization and trade-offs"
    ],
    product_management: [
      "Product sense and user empathy",
      "Data-driven decision making and metrics",
      "Strategic thinking and prioritization",
      "Stakeholder management and communication",
      "Technical understanding and trade-offs",
      "Execution and delivery focus"
    ],
    program_management: [
      "Cross-functional leadership and influence",
      "Risk identification and mitigation",
      "Stakeholder alignment and communication",
      "Timeline and resource management",
      "Process improvement and efficiency",
      "Conflict resolution and problem-solving"
    ],
    general: [
      "Clarity and structure",
      "Depth of knowledge",
      "Problem-solving approach",
      "Communication effectiveness",
      "Confidence and professionalism"
    ]
  };

  const contextInfo = [];
  if (resume) contextInfo.push(`**Candidate Background:** ${resume.slice(0, 500)}...`);
  if (jobDescription) contextInfo.push(`**Target Role:** ${jobDescription.slice(0, 500)}...`);

  const companyEvaluation = targetCompany === "amazon" && question.leadershipPrinciple
    ? `\n\nAlso evaluate how well the answer demonstrates Amazon's Leadership Principle: "${question.leadershipPrinciple}". Include a "companySpecificNotes" field about LP alignment.`
    : targetCompany !== "generic"
      ? `\n\nAlso evaluate according to ${targetCompany.charAt(0).toUpperCase() + targetCompany.slice(1)}'s specific interview culture and expectations. Include a "companySpecificNotes" field with company-specific observations.`
      : "";

  const companyJsonField = targetCompany !== "generic"
    ? `,\n  "companySpecificNotes": "How this answer aligns (or doesn't) with ${targetCompany}'s interview culture"`
    : "";

  return `You are a senior FAANG interview coach providing detailed feedback on interview performance.

**Interview Question:**
${question.question}
${question.context ? `\n**Context:** ${question.context}` : ""}
${question.leadershipPrinciple ? `\n**Amazon LP:** ${question.leadershipPrinciple}` : ""}

**Candidate's Answer:**
${answer}

${contextInfo.length > 0 ? contextInfo.join("\n\n") + "\n\n" : ""}

**Expected Key Points:**
${question.expectedKeyPoints?.map((p, i) => `${i + 1}. ${p}`).join("\n") || "N/A"}

Evaluate this answer based on FAANG interview standards for ${type} interviews, focusing on:
${evaluationCriteria[type].map(c => `- ${c}`).join("\n")}${companyEvaluation}

Also generate 1-2 follow-up questions a real interviewer would ask based on gaps or interesting parts of this answer.
${buildCoachingOutputFormatInstructions()}
${buildSuggestedAnswerInstructions(type)}

Example JSON (part 1 only):
\`\`\`json
{
  "score": 75,
  "strengths": ["Specific strength referencing the answer"],
  "improvements": ["Specific improvement referencing the answer"],
  "faangComparison": "2-3 sentences comparing to what a successful FAANG candidate would say.",
  "suggestedAnswer": "",
  "nextSteps": ["Actionable step 1", "Actionable step 2"],
  "followUpQuestions": ["A probing follow-up question based on their answer", "Another follow-up"]${companyJsonField}
}
\`\`\`
Then output the three level delimiters and answers (part 2):
${FAANG_MODEL_ANSWER_L4_DELIMITER}
...
${FAANG_MODEL_ANSWER_L5_DELIMITER}
...
${FAANG_MODEL_ANSWER_L6_DELIMITER}
...

Score scale:
- 90-100: Exceptional, would get strong hire at FAANG
- 80-89: Strong answer, likely hire
- 70-79: Good answer with minor gaps
- 60-69: Acceptable but needs improvement
- Below 60: Significant gaps, needs work

Be encouraging but honest. Reference specific parts of the candidate's answer.`;
}

/**
 * Parse interview questions from AI response
 */
function parseQuestionsFromResponse(response: string): InterviewQuestion[] {
  try {
    let jsonText = response.trim();
    const fenceMatch = jsonText.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (fenceMatch) {
      jsonText = fenceMatch[1].trim();
    } else {
      const arrayStart = jsonText.indexOf("[");
      const arrayEnd = jsonText.lastIndexOf("]");
      if (arrayStart >= 0 && arrayEnd > arrayStart) {
        jsonText = jsonText.slice(arrayStart, arrayEnd + 1);
      }
    }

    const questions = JSON.parse(jsonText);
    if (!Array.isArray(questions) || questions.length === 0) {
      throw new Error("Expected a non-empty JSON array of questions");
    }

    return questions.map((q: any, index: number) => ({
      id: `q${index + 1}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      question: q.question,
      context: q.context,
      difficulty: q.difficulty || "medium",
      category: q.category || "General",
      expectedKeyPoints: q.expectedKeyPoints || [],
      ...(q.leadershipPrinciple ? { leadershipPrinciple: q.leadershipPrinciple } : {}),
    }));
  } catch (error) {
    console.error("Failed to parse questions:", error);
    throw new Error("Failed to parse questions from AI response");
  }
}

/**
 * Parse coaching feedback from AI response
 */
function parseCoachingFeedback(response: string): CoachingFeedback {
  return parseCoachingFromResponse(response);
}

/**
 * Fetch AI completion using the app's existing API
 */
async function fetchAICompletion(systemPrompt: string, userMessage: string): Promise<string> {
  const { fetchAIResponse } = await import("./functions");
  const { shouldUseHostedAPI } = await import("./functions/hosted.api");
  const { AI_PROVIDERS, STORAGE_KEYS } = await import("@/config");
  const { getCustomAiProviders } = await import("./storage/ai-providers");
  const { safeLocalStorage } = await import("./storage/helper");

  const useHostedAPI = await shouldUseHostedAPI();

  let selectedProvider: { provider: string; variables: Record<string, string> } = {
    provider: "",
    variables: {},
  };

  const savedSelectedAi = safeLocalStorage.getItem(STORAGE_KEYS.SELECTED_AI_PROVIDER);
  if (savedSelectedAi) {
    try {
      selectedProvider = JSON.parse(savedSelectedAi);
    } catch {
      /* use defaults */
    }
  }

  const allAiProviders = [...AI_PROVIDERS, ...getCustomAiProviders()];
  const provider = allAiProviders.find((p) => p.id === selectedProvider.provider);

  if (!useHostedAPI) {
    if (!selectedProvider.provider) {
      throw new Error(
        "No AI provider configured. Open Settings and select an AI provider (or enable Attune API)."
      );
    }
    if (!provider) {
      throw new Error(
        "Selected AI provider was not found. Open Settings and re-select your AI provider."
      );
    }
  }

  const chunks: string[] = [];

  try {
    for await (const chunk of fetchAIResponse({
      provider: useHostedAPI ? undefined : provider,
      selectedProvider,
      systemPrompt,
      userMessage,
      history: [],
      imagesBase64: [],
      systemPromptOnly: true,
    })) {
      chunks.push(chunk);
    }

    return chunks.join("");
  } catch (error) {
    console.error("AI completion error:", error);
    throw new Error(
      error instanceof Error ? error.message : "Unknown error"
    );
  }
}

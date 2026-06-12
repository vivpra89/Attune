import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { Button, ScrollArea, Switch } from "@/components";
import {
  BriefcaseIcon,
  FileTextIcon,
  GraduationCapIcon,
  SparklesIcon,
  PlayIcon,
  CheckIcon,
  MicIcon,
  Loader2,
  XIcon,
  RefreshCwIcon,
  TrophyIcon,
  MessageSquareIcon,
  TargetIcon,
  NetworkIcon,
  HistoryIcon,
  BuildingIcon,
  SlidersHorizontalIcon,
  PenLineIcon,
  TimerIcon,
  AlertTriangleIcon,
  MessageCircleQuestionIcon,
  Volume2Icon,
  VolumeXIcon,
  SkipForwardIcon,
  ListChecksIcon,
  ClipboardListIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { isMacOS } from "@/lib/platform";
import { STORAGE_KEYS } from "@/config";
import {
  DEFAULT_INTERVIEW_CONTEXT,
  getCoachingFocusAreas,
  getInterviewContext,
  persistInterviewContext,
  setCoachingFocusAreas,
} from "@/lib/storage/interview-context.storage";
import type { InterviewContext } from "@/types";
import {
  DEEPGRAM_TTS_VOICES,
  TTS_TEST_PHRASE,
} from "@/config";
import {
  buildOpeningSpeech,
  buildNextQuestionSpeech,
  buildFollowUpSpeech,
  buildFeedbackSpeech,
  buildCompleteSpeech,
} from "@/lib/interviewSpeech";

import { Markdown } from "@/components";
import { SessionHistoryPanel, getWeakCategories } from "./SessionHistoryPanel";

export type InterviewType = "technical" | "behavioral" | "system_design" | "coding" | "product_management" | "program_management" | "general";

export type TargetCompany = "amazon" | "google" | "meta" | "apple" | "netflix" | "microsoft" | "generic";

export interface SessionConfig {
  questionCount: number;
  difficultyFocus: "mixed" | "easy" | "medium" | "hard" | "adaptive";
  enableFollowUps: boolean;
  enableCountdown: boolean;
}

export const DEFAULT_SESSION_CONFIG: SessionConfig = {
  questionCount: 5,
  difficultyFocus: "mixed",
  enableFollowUps: true,
  enableCountdown: false,
};

export interface InterviewCoachingSession {
  id: string;
  type: InterviewType;
  targetCompany: TargetCompany;
  resume?: string;
  jobDescription?: string;
  projects?: string[];
  questionFocusAreas?: string;
  currentQuestionIndex: number;
  questions: InterviewQuestion[];
  answers: InterviewAnswer[];
  followUpAnswers: FollowUpAnswer[];
  overallScore: number;
  config: SessionConfig;
  createdAt: number;
  updatedAt: number;
}

export interface InterviewQuestion {
  id: string;
  question: string;
  context?: string;
  difficulty: "easy" | "medium" | "hard";
  category: string;
  expectedKeyPoints?: string[];
  leadershipPrinciple?: string;
}

export interface InterviewAnswer {
  questionId: string;
  transcriptText: string;
  timestamp: number;
  coaching: CoachingFeedback;
}

export interface FollowUpAnswer {
  parentQuestionId: string;
  followUpQuestion: string;
  transcriptText: string;
  timestamp: number;
  feedback: string;
}

export type InterviewLevel = "L4" | "L5" | "L6";

export interface CoachingFeedback {
  score: number; // 0-100
  strengths: string[];
  improvements: string[];
  faangComparison: string;
  suggestedAnswer?: string;
  levelAnswers?: Partial<Record<InterviewLevel, string>>;
  nextSteps: string[];
  companySpecificNotes?: string;
  followUpQuestions?: string[];
}

export const INTERVIEW_LEVEL_GUIDE: Record<
  InterviewLevel,
  { label: string; title: string; description: string; pillClass: string }
> = {
  L4: {
    label: "L4",
    title: "Mid-level IC",
    description:
      "Competent individual contributor — clear structure, correct depth, executes on scoped work.",
    pillClass: "bg-sky-100 text-sky-800 dark:bg-sky-950/50 dark:text-sky-300",
  },
  L5: {
    label: "L5",
    title: "Senior IC",
    description:
      "Senior scope — drives decisions, mentors others, quantifies team-level impact and trade-offs.",
    pillClass: "bg-primary/15 text-primary",
  },
  L6: {
    label: "L6",
    title: "Staff+",
    description:
      "Org-level impact — strategy across teams, handles ambiguity, influences direction and outcomes.",
    pillClass: "bg-violet-100 text-violet-800 dark:bg-violet-950/50 dark:text-violet-300",
  },
};

export const INTERVIEW_LEVELS: InterviewLevel[] = ["L4", "L5", "L6"];

function resolveModelAnswers(
  feedback: CoachingFeedback
): Partial<Record<InterviewLevel, string>> {
  if (feedback.levelAnswers && INTERVIEW_LEVELS.some((level) => feedback.levelAnswers?.[level]?.trim())) {
    return feedback.levelAnswers;
  }
  if (feedback.suggestedAnswer?.trim()) {
    return { L5: feedback.suggestedAnswer.trim() };
  }
  return {};
}

const COMPANY_DATA: { id: TargetCompany; label: string; description: string }[] = [
  { id: "amazon", label: "Amazon", description: "Leadership Principles" },
  { id: "google", label: "Google", description: "Googleyness & structured" },
  { id: "meta", label: "Meta", description: "Product sense & metrics" },
  { id: "apple", label: "Apple", description: "Design & attention to detail" },
  { id: "netflix", label: "Netflix", description: "Culture & high performance" },
  { id: "microsoft", label: "Microsoft", description: "Growth mindset" },
  { id: "generic", label: "Generic FAANG", description: "General top-tier prep" },
];

export const AMAZON_LPS = [
  "Customer Obsession", "Ownership", "Invent and Simplify", "Are Right, A Lot",
  "Learn and Be Curious", "Hire and Develop the Best", "Insist on the Highest Standards",
  "Think Big", "Bias for Action", "Frugality", "Earn Trust", "Dive Deep",
  "Have Backbone; Disagree and Commit", "Deliver Results", "Strive to be Earth's Best Employer",
  "Success and Scale Bring Broad Responsibility",
];

const COUNTDOWN_DEFAULTS: Record<InterviewType, number> = {
  behavioral: 120,
  technical: 120,
  system_design: 360,
  coding: 180,
  product_management: 150,
  program_management: 150,
  general: 120,
};

function optionPillClass(selected: boolean) {
  return cn(
    "px-3 py-2 rounded-md text-xs font-medium transition-all border shrink-0",
    selected
      ? "bg-primary text-primary-foreground border-primary shadow-sm"
      : "bg-background text-foreground border-border hover:border-primary/40 hover:bg-muted/40"
  );
}

export type CoachingPhase =
  | "setup"
  | "question_preview"
  | "interview"
  | "coaching"
  | "follow_up"
  | "complete"
  | "history"
  | "review";

interface InterviewCoachingModeProps {
  onClose?: () => void;
  onStartListening: (questionId: string) => void;
  onStopListening: () => void;
  onSessionReset?: () => void;
  onSessionContext: (
    question: InterviewQuestion,
    type: string,
    resume?: string,
    jobDescription?: string,
    targetCompany?: TargetCompany
  ) => void;
  isListening: boolean;
  currentTranscript: string;
  onSubmitAnswer: (questionId: string, transcript: string) => Promise<CoachingFeedback>;
  onGenerateFollowUp?: (question: InterviewQuestion, answer: string, feedback: CoachingFeedback) => Promise<string>;
  ttsEnabled: boolean;
  onTtsEnabledChange: (enabled: boolean) => void;
  ttsApiKey: string;
  onTtsApiKeyChange: (key: string) => void;
  ttsModel: string;
  onTtsModelChange: (model: string) => void;
  speak: (text: string, options?: { onEnd?: () => void }) => Promise<void>;
  stopTts: () => void;
  unlockAudio: () => void;
  isTtsSpeaking: boolean;
  isTtsLoading: boolean;
  ttsError: string | null;
  className?: string;
}

export const InterviewCoachingMode = ({
  onClose,
  onStartListening,
  onStopListening,
  onSessionReset,
  onSessionContext,
  isListening,
  currentTranscript,
  onSubmitAnswer,
  onGenerateFollowUp,
  ttsEnabled,
  onTtsEnabledChange,
  ttsApiKey,
  onTtsApiKeyChange,
  ttsModel,
  onTtsModelChange,
  speak,
  stopTts,
  unlockAudio,
  isTtsSpeaking,
  isTtsLoading,
  ttsError,
  className,
}: InterviewCoachingModeProps) => {
  const [phase, setPhase] = useState<CoachingPhase>("setup");
  const [session, setSession] = useState<InterviewCoachingSession | null>(null);
  const [loading, setLoading] = useState(false);
  const [regeneratingQuestions, setRegeneratingQuestions] = useState(false);
  const [error, setError] = useState<string>("");

  // Setup state — resume/JD loaded from shared interview context (localStorage)
  const [interviewType, setInterviewType] = useState<InterviewType>("technical");
  const [targetCompany, setTargetCompany] = useState<TargetCompany>("generic");
  const [resume, setResume] = useState(() => getInterviewContext().resume);
  const [jobDescription, setJobDescription] = useState(
    () => getInterviewContext().jobDescription
  );
  const [questionFocusAreas, setQuestionFocusAreas] = useState(() =>
    getCoachingFocusAreas()
  );
  const [sessionConfig, setSessionConfig] = useState<SessionConfig>(DEFAULT_SESSION_CONFIG);

  // Interview state
  const [currentQuestion, setCurrentQuestion] = useState<InterviewQuestion | null>(null);
  const [answerDraft, setAnswerDraft] = useState("");
  const [coachingFeedback, setCoachingFeedback] = useState<CoachingFeedback | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [useTextInput, setUseTextInput] = useState(false);
  const [textAnswer, setTextAnswer] = useState("");

  // Follow-up state
  const [followUpQuestion, setFollowUpQuestion] = useState("");
  const [followUpAnswer, setFollowUpAnswer] = useState("");
  const [followUpUseTextInput, setFollowUpUseTextInput] = useState(false);
  const [followUpLoading, setFollowUpLoading] = useState(false);

  // Coaching phase tab
  const [coachingTab, setCoachingTab] = useState<"score" | "feedback" | "model" | "next">("score");
  const [modelLevel, setModelLevel] = useState<InterviewLevel>("L5");

  // Review state (viewing past session)
  const [reviewSession, setReviewSession] = useState<InterviewCoachingSession | null>(null);

  // Timer for answer duration
  const [answerSeconds, setAnswerSeconds] = useState(0);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const textTimerStartedRef = useRef(false);
  const spokenQuestionIdRef = useRef<string | null>(null);
  const spokenFollowUpRef = useRef<string | null>(null);
  const spokenFeedbackKeyRef = useRef<string | null>(null);
  const spokenCompleteRef = useRef(false);
  const [isTestingVoice, setIsTestingVoice] = useState(false);

  // Weak categories for adaptive suggestions
  const weakCategories = useMemo(() => getWeakCategories(), [phase]);

  const applyInterviewContext = useCallback((ctx: InterviewContext) => {
    setResume(ctx.resume);
    setJobDescription(ctx.jobDescription);
  }, []);

  // Persist resume and JD to shared interview context (localStorage)
  useEffect(() => {
    const timer = setTimeout(() => {
      void persistInterviewContext({
        resume,
        jobDescription,
      });
    }, 600);
    return () => clearTimeout(timer);
  }, [resume, jobDescription]);

  // Persist question focus areas separately (coaching-specific)
  useEffect(() => {
    const timer = setTimeout(() => {
      setCoachingFocusAreas(questionFocusAreas);
    }, 600);
    return () => clearTimeout(timer);
  }, [questionFocusAreas]);

  // Sync when updated from dashboard or another window
  useEffect(() => {
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key !== STORAGE_KEYS.INTERVIEW_CONTEXT || !e.newValue) return;
      try {
        applyInterviewContext({
          ...DEFAULT_INTERVIEW_CONTEXT,
          ...JSON.parse(e.newValue),
        });
      } catch {
        /* ignore malformed storage */
      }
    };

    window.addEventListener("storage", handleStorageChange);

    let unlisten: (() => void) | undefined;
    import("@tauri-apps/api/event")
      .then(({ listen }) =>
        listen<{ interviewContext?: InterviewContext }>(
          "attune-interview-sync",
          (event) => {
            if (event.payload.interviewContext) {
              applyInterviewContext({
                ...DEFAULT_INTERVIEW_CONTEXT,
                ...event.payload.interviewContext,
              });
            }
          }
        )
      )
      .then((fn) => {
        unlisten = fn;
      })
      .catch(() => {
        /* not in tauri */
      });

    return () => {
      window.removeEventListener("storage", handleStorageChange);
      unlisten?.();
    };
  }, [applyInterviewContext]);

  const resetLiveSessionState = useCallback(() => {
    stopTts();
    onStopListening();
    onSessionReset?.();
    setCoachingFeedback(null);
    setAnswerDraft("");
    setTextAnswer("");
    setFollowUpQuestion("");
    setFollowUpAnswer("");
    setFollowUpUseTextInput(false);
    setFollowUpLoading(false);
    setIsSubmitting(false);
    setCoachingTab("score");
    setModelLevel("L5");
    setAnswerSeconds(0);
    setUseTextInput(false);
    setError("");
    spokenQuestionIdRef.current = null;
    spokenFollowUpRef.current = null;
    spokenFeedbackKeyRef.current = null;
    spokenCompleteRef.current = false;
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    textTimerStartedRef.current = false;
  }, [stopTts, onStopListening, onSessionReset]);

  // Voice mode timer — starts/stops with VAD listening state
  useEffect(() => {
    if (isListening) {
      textTimerStartedRef.current = false;
      setAnswerSeconds(0);
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = setInterval(() => setAnswerSeconds((s) => s + 1), 1000);
    } else {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isListening]);

  // Text mode timer — starts on first keystroke; stops when text mode is disabled
  useEffect(() => {
    if (!useTextInput) {
      // Switched back to voice mode — clean up any text-mode interval
      textTimerStartedRef.current = false;
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      return;
    }
    // Start the interval only once (on first character typed)
    if (textAnswer.length > 0 && !textTimerStartedRef.current && !isListening) {
      textTimerStartedRef.current = true;
      setAnswerSeconds(0);
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = setInterval(() => setAnswerSeconds((s) => s + 1), 1000);
    }
    // No cleanup return here — the interval must persist across keystrokes
    // Voice-mode effect handles cleanup when isListening changes
  }, [useTextInput, textAnswer, isListening]);

  // Conversational flow: interviewer speaks questions automatically
  useEffect(() => {
    if (phase !== "interview" || !currentQuestion || !session || !ttsEnabled) return;
    if (spokenQuestionIdRef.current === currentQuestion.id) return;

    spokenQuestionIdRef.current = currentQuestion.id;
    onStopListening();

    const isOpening =
      session.currentQuestionIndex === 0 && session.answers.length === 0;
    const text = isOpening
      ? buildOpeningSpeech(session.type, session.questions.length, currentQuestion)
      : buildNextQuestionSpeech(
          session.currentQuestionIndex,
          session.questions.length,
          currentQuestion
        );

    speak(text, {
      onEnd: () => {
        if (!useTextInput) {
          onStartListening(currentQuestion.id);
        }
      },
    });
  }, [
    phase,
    currentQuestion,
    session,
    ttsEnabled,
    speak,
    onStartListening,
    onStopListening,
    useTextInput,
  ]);

  // Conversational flow: follow-up questions
  useEffect(() => {
    if (phase !== "follow_up" || !followUpQuestion || !ttsEnabled) return;
    if (spokenFollowUpRef.current === followUpQuestion) return;

    spokenFollowUpRef.current = followUpQuestion;
    onStopListening();

    speak(buildFollowUpSpeech(followUpQuestion), {
      onEnd: () => {
        if (!followUpUseTextInput && currentQuestion) {
          onStartListening(currentQuestion.id);
        }
      },
    });
  }, [
    phase,
    followUpQuestion,
    ttsEnabled,
    speak,
    onStopListening,
    onStartListening,
    followUpUseTextInput,
    currentQuestion,
  ]);

  // Conversational flow: spoken feedback after each answer
  useEffect(() => {
    if (phase !== "coaching" || !coachingFeedback || !ttsEnabled) return;

    const key = `${session?.answers.length ?? 0}-${coachingFeedback.score}`;
    if (spokenFeedbackKeyRef.current === key) return;

    spokenFeedbackKeyRef.current = key;
    speak(buildFeedbackSpeech(coachingFeedback));
  }, [phase, coachingFeedback, ttsEnabled, session?.answers.length, speak]);

  // Conversational flow: closing summary
  useEffect(() => {
    if (phase !== "complete" || !session || !ttsEnabled || spokenCompleteRef.current) return;

    spokenCompleteRef.current = true;
    speak(buildCompleteSpeech(session.overallScore, session.questions.length));
  }, [phase, session, ttsEnabled, speak]);

  // Stop speech only when exiting the session entirely
  useEffect(() => {
    if (phase === "history" || phase === "review") {
      stopTts();
    }
  }, [phase, stopTts]);

  const handleTestVoice = async () => {
    unlockAudio();
    setIsTestingVoice(true);
    try {
      await speak(TTS_TEST_PHRASE);
    } finally {
      setIsTestingVoice(false);
    }
  };

  const interviewTypes = [
    { id: "technical" as const, label: "Technical Interview", icon: GraduationCapIcon, description: "Deep-dive technical questions" },
    { id: "behavioral" as const, label: "Behavioral Interview", icon: MessageSquareIcon, description: "Leadership & teamwork scenarios" },
    { id: "system_design" as const, label: "System Design", icon: BriefcaseIcon, description: "Architecture & scalability" },
    { id: "coding" as const, label: "Coding Interview", icon: FileTextIcon, description: "Algorithm & data structures" },
    { id: "product_management" as const, label: "Product Management", icon: TargetIcon, description: "Product strategy & execution" },
    { id: "program_management" as const, label: "Program Management", icon: NetworkIcon, description: "Cross-team coordination" },
    { id: "general" as const, label: "General Interview", icon: SparklesIcon, description: "Mixed question types" },
  ];

  const handleStartInterview = async () => {
    if (ttsEnabled && !ttsApiKey.trim()) {
      setError("Add your Deepgram API key under Interviewer Voice to start a conversational interview.");
      return;
    }

    resetLiveSessionState();
    setLoading(true);

    try {
      const questions = await generateInterviewQuestions(
        interviewType,
        resume,
        jobDescription,
        targetCompany,
        sessionConfig,
        [],
        questionFocusAreas
      );

      const newSession: InterviewCoachingSession = {
        id: `interview-${Date.now()}`,
        type: interviewType,
        targetCompany,
        resume,
        jobDescription,
        questionFocusAreas,
        currentQuestionIndex: 0,
        questions,
        answers: [],
        followUpAnswers: [],
        overallScore: 0,
        config: sessionConfig,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      setSession(newSession);
      setCurrentQuestion(null);
      setPhase("question_preview");
    } catch (err) {
      setError(`Failed to generate questions: ${err}`);
    } finally {
      setLoading(false);
    }
  };

  const handleBeginInterview = () => {
    if (!session || session.questions.length === 0) return;

    resetLiveSessionState();
    unlockAudio();
    const firstQuestion = session.questions[0];
    setCurrentQuestion(firstQuestion);
    onSessionContext(
      firstQuestion,
      session.type,
      session.resume || undefined,
      session.jobDescription || undefined,
      session.targetCompany
    );
    setPhase("interview");
  };

  const handleRegenerateQuestions = async () => {
    if (!session) return;

    setRegeneratingQuestions(true);
    setError("");

    try {
      const questions = await generateInterviewQuestions(
        session.type,
        session.resume || resume,
        session.jobDescription || jobDescription,
        session.targetCompany,
        session.config,
        session.questions.map((q) => q.question),
        session.questionFocusAreas || questionFocusAreas
      );

      const updatedSession: InterviewCoachingSession = {
        ...session,
        resume: session.resume || resume,
        jobDescription: session.jobDescription || jobDescription,
        questionFocusAreas: session.questionFocusAreas || questionFocusAreas,
        questions,
        currentQuestionIndex: 0,
        updatedAt: Date.now(),
      };

      setSession(updatedSession);
    } catch (err) {
      setError(`Failed to regenerate questions: ${err}`);
    } finally {
      setRegeneratingQuestions(false);
    }
  };

  const advanceToQuestion = (nextIndex: number) => {
    if (!session) return;

    if (nextIndex >= session.questions.length) {
      const avgScore =
        session.answers.length > 0
          ? session.answers.reduce((sum, a) => sum + a.coaching.score, 0) /
            session.answers.length
          : 0;

      const updatedSession = {
        ...session,
        currentQuestionIndex: nextIndex,
        overallScore: avgScore,
        updatedAt: Date.now(),
      };

      setSession(updatedSession);
      setPhase("complete");
      saveInterviewSession(updatedSession);
      return;
    }

    const updatedSession = {
      ...session,
      currentQuestionIndex: nextIndex,
      updatedAt: Date.now(),
    };

    setSession(updatedSession);
    setCurrentQuestion(session.questions[nextIndex]);
    onSessionContext(
      session.questions[nextIndex],
      session.type,
      session.resume || undefined,
      session.jobDescription || undefined,
      session.targetCompany
    );
    setCoachingFeedback(null);
    setAnswerDraft("");
    setTextAnswer("");
    setFollowUpQuestion("");
    setFollowUpAnswer("");
    onStopListening();
    onSessionReset?.();
    spokenQuestionIdRef.current = null;
    setPhase("interview");
  };

  const handleSkipQuestion = () => {
    if (!session || !currentQuestion) return;

    stopTts();
    onStopListening();
    setError("");
    advanceToQuestion(session.currentQuestionIndex + 1);
  };

  const handleStartAnswer = () => {
    if (currentQuestion) {
      onStartListening(currentQuestion.id);
      setAnswerDraft("");
    }
  };

  const handleStopAnswer = () => {
    onStopListening();
    setAnswerDraft(currentTranscript);
  };

  const handleStartFollowUpAnswer = () => {
    if (currentQuestion) {
      onStartListening(currentQuestion.id);
      setFollowUpAnswer("");
    }
  };

  const handleStopFollowUpAnswer = () => {
    onStopListening();
    setFollowUpAnswer(currentTranscript);
  };

  const handleSubmitCurrentAnswer = async () => {
    if (!currentQuestion || !session) return;

    const finalTranscript = useTextInput ? textAnswer : (currentTranscript || answerDraft);
    if (!finalTranscript.trim()) {
      setError("Please provide an answer before submitting");
      return;
    }

    setIsSubmitting(true);
    setError("");

    try {
      const feedback = await onSubmitAnswer(currentQuestion.id, finalTranscript);

      const answer: InterviewAnswer = {
        questionId: currentQuestion.id,
        transcriptText: finalTranscript,
        timestamp: Date.now(),
        coaching: feedback,
      };

      const updatedSession = {
        ...session,
        answers: [...session.answers, answer],
        updatedAt: Date.now(),
      };

      setSession(updatedSession);
      setCoachingFeedback(feedback);
      setCoachingTab("score");
      setModelLevel("L5");
      spokenFeedbackKeyRef.current = null;
      setPhase("coaching");

      saveInterviewSession(updatedSession);
    } catch (err) {
      setError(`Failed to get coaching feedback: ${err}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRetryQuestion = () => {
    stopTts();
    onStopListening();
    onSessionReset?.();
    spokenQuestionIdRef.current = null;
    spokenFeedbackKeyRef.current = null;
    setCoachingFeedback(null);
    setAnswerDraft("");
    setTextAnswer("");
    setFollowUpQuestion("");
    setFollowUpAnswer("");
    setError("");
    setAnswerSeconds(0);
    setCoachingTab("score");
    setPhase("interview");
  };

  const handleFollowUp = async () => {
    if (!currentQuestion || !coachingFeedback || !onGenerateFollowUp || !session) return;
    setFollowUpLoading(true);
    try {
      const lastAnswer = session.answers[session.answers.length - 1];
      const fq = await onGenerateFollowUp(currentQuestion, lastAnswer.transcriptText, coachingFeedback);
      onSessionReset?.();
      spokenFollowUpRef.current = null;
      setFollowUpQuestion(fq);
      setFollowUpAnswer("");
      setFollowUpUseTextInput(false);
      setPhase("follow_up");
    } catch (err) {
      setError(`Failed to generate follow-up: ${err}`);
    } finally {
      setFollowUpLoading(false);
    }
  };

  const handleSubmitFollowUp = () => {
    if (!session || !currentQuestion) return;

    const finalAnswer = followUpUseTextInput
      ? followUpAnswer.trim()
      : (currentTranscript || followUpAnswer).trim();
    if (!finalAnswer) return;

    const fuAnswer: FollowUpAnswer = {
      parentQuestionId: currentQuestion.id,
      followUpQuestion,
      transcriptText: finalAnswer,
      timestamp: Date.now(),
      feedback: "",
    };
    const updatedSession = {
      ...session,
      followUpAnswers: [...session.followUpAnswers, fuAnswer],
      updatedAt: Date.now(),
    };
    setSession(updatedSession);
    saveInterviewSession(updatedSession);
    onStopListening();
    onSessionReset?.();
    setPhase("coaching");
  };

  const handleNextQuestion = () => {
    if (!session) return;
    advanceToQuestion(session.currentQuestionIndex + 1);
  };

  const handleRestart = () => {
    resetLiveSessionState();
    setSession(null);
    setCurrentQuestion(null);
    setReviewSession(null);
    setPhase("setup");
  };

  const handleBackToSetup = () => {
    resetLiveSessionState();
    setSession(null);
    setCurrentQuestion(null);
    setPhase("setup");
  };

  const progressPercentage = session
    ? (session.currentQuestionIndex / session.questions.length) * 100
    : 0;

  const macTitleBar = isMacOS();

  return (
    <div className={cn("flex flex-col h-full bg-background", className)}>
      {/* Header — inset on macOS so traffic lights don't cover the title */}
      <div
        className={cn(
          "flex-shrink-0 border-b border-border/50 bg-gradient-to-r from-primary/5 to-primary/10",
          macTitleBar ? "pt-10" : "pt-4"
        )}
      >
        <div
          className={cn(
            "flex items-center justify-between gap-4 pb-4 pr-6",
            macTitleBar ? "pl-[5.75rem]" : "pl-6"
          )}
        >
          <div
            data-tauri-drag-region={macTitleBar ? true : undefined}
            className="flex items-center gap-3 min-w-0 flex-1 select-none"
          >
            <TrophyIcon className="w-6 h-6 text-primary shrink-0" />
            <h2 className="text-xl font-bold truncate">Interview Coaching Mode</h2>
          </div>
          {session && !["complete", "history", "review", "question_preview"].includes(phase) && (
            <div
              data-tauri-drag-region={macTitleBar ? true : undefined}
              className="hidden sm:flex items-center gap-4 shrink-0 select-none"
            >
              <div className="text-sm font-medium text-muted-foreground whitespace-nowrap">
                Question {Math.min(session.currentQuestionIndex + 1, session.questions.length)} of{" "}
                {session.questions.length}
              </div>
              <div className="w-40 h-2.5 bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary transition-all duration-300"
                  style={{ width: `${progressPercentage}%` }}
                />
              </div>
            </div>
          )}
          <div className="flex items-center gap-2 shrink-0">
            {phase === "setup" && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setPhase("history")}
                className="text-xs"
              >
                <HistoryIcon className="w-3.5 h-3.5 mr-1" />
                History
              </Button>
            )}
            {(phase === "question_preview" ||
              phase === "interview" ||
              phase === "coaching" ||
              phase === "follow_up") && (
              <Button
                size="sm"
                variant="ghost"
                onClick={handleRestart}
                className="text-xs"
              >
                <RefreshCwIcon className="w-3.5 h-3.5 mr-1" />
                Restart
              </Button>
            )}
            {onClose && (
              <Button
                size="icon"
                variant="ghost"
                onClick={onClose}
                className="h-9 w-9 rounded-full"
                title="Close Interview Coach"
              >
                <XIcon className="h-5 w-5" />
              </Button>
            )}
          </div>
        </div>
      </div>

      <ScrollArea className="flex-1 min-h-0">
        <div className="p-8 max-w-7xl mx-auto space-y-6">
          {/* History Phase */}
          {phase === "history" && (
            <SessionHistoryPanel
              onClose={() => setPhase("setup")}
              onReviewSession={(s) => {
                setReviewSession(s);
                setPhase("review");
              }}
            />
          )}

          {/* Review Phase — read-only view of a past session */}
          {phase === "review" && reviewSession && (
            <div className="max-w-5xl mx-auto space-y-6">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold">Session Review</h3>
                <Button size="sm" variant="outline" onClick={() => setPhase("history")}>
                  Back to History
                </Button>
              </div>
              <div className="p-4 rounded-lg border-2 border-primary/20 bg-primary/5 text-center">
                <div className="text-3xl font-bold text-primary">{reviewSession.overallScore.toFixed(0)}/100</div>
                <p className="text-xs text-muted-foreground mt-1">
                  {new Date(reviewSession.createdAt).toLocaleDateString()} — {reviewSession.type.replace("_", " ")}
                  {reviewSession.targetCompany !== "generic" && ` — ${reviewSession.targetCompany}`}
                </p>
              </div>
              {reviewSession.answers.map((answer, idx) => {
                const question = reviewSession.questions.find((q) => q.id === answer.questionId);
                return (
                  <div key={answer.questionId} className="p-4 rounded-lg border border-border space-y-3">
                    <div className="flex items-start justify-between gap-3">
                      <p className="text-sm font-medium">Q{idx + 1}: {question?.question}</p>
                      <span className={cn(
                        "px-2 py-1 rounded-full text-xs font-semibold shrink-0",
                        answer.coaching.score >= 80 && "bg-green-100 text-green-700",
                        answer.coaching.score >= 60 && answer.coaching.score < 80 && "bg-yellow-100 text-yellow-700",
                        answer.coaching.score < 60 && "bg-red-100 text-red-700",
                      )}>
                        {answer.coaching.score}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground italic">"{answer.transcriptText.slice(0, 300)}{answer.transcriptText.length > 300 ? "..." : ""}"</p>
                    {answer.coaching.strengths.length > 0 && (
                      <div>
                        <p className="text-[10px] font-semibold text-green-700 dark:text-green-400">Strengths</p>
                        <ul className="text-xs text-muted-foreground list-disc list-inside">{answer.coaching.strengths.map((s, i) => <li key={i}>{s}</li>)}</ul>
                      </div>
                    )}
                    {answer.coaching.improvements.length > 0 && (
                      <div>
                        <p className="text-[10px] font-semibold text-amber-700 dark:text-amber-400">Improvements</p>
                        <ul className="text-xs text-muted-foreground list-disc list-inside">{answer.coaching.improvements.map((s, i) => <li key={i}>{s}</li>)}</ul>
                      </div>
                    )}
                  </div>
                );
              })}
              <Button onClick={() => setPhase("history")} variant="outline" className="w-full">Back to History</Button>
            </div>
          )}

          {/* Setup Phase */}
          {phase === "setup" && (
            <div className="max-w-4xl mx-auto space-y-8">
              <div className="text-center space-y-2">
                <h3 className="text-xl font-semibold">
                  Prepare for Your Interview
                </h3>
                <p className="text-sm text-muted-foreground">
                  Get personalized questions and FAANG-level coaching based on your
                  profile
                </p>
              </div>

              {/* Adaptive Recommendations */}
              {weakCategories.length > 0 && (
                <div className="p-3 rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30 flex items-start gap-2">
                  <AlertTriangleIcon className="w-4 h-4 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
                  <div>
                    <p className="text-xs font-semibold text-amber-800 dark:text-amber-300">Recommended Focus Areas</p>
                    <p className="text-xs text-amber-700 dark:text-amber-400 mt-0.5">
                      Based on past sessions, consider practicing:{" "}
                      {weakCategories.map((w) => `${w.category} (avg ${w.avg})`).join(", ")}
                    </p>
                  </div>
                </div>
              )}

              {/* Target Company */}
              <div className="space-y-3">
                <label className="text-sm font-medium flex items-center gap-2">
                  <BuildingIcon className="w-4 h-4" />
                  Target Company
                </label>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  {COMPANY_DATA.map((company) => (
                    <button
                      key={company.id}
                      type="button"
                      onClick={() => setTargetCompany(company.id)}
                      className={cn(
                        "flex flex-col items-center gap-1 p-3 rounded-lg border transition-all text-center bg-background",
                        targetCompany === company.id
                          ? "border-primary ring-1 ring-primary/30 bg-primary/5"
                          : "border-border hover:border-primary/50"
                      )}
                    >
                      <div className="text-sm font-medium">{company.label}</div>
                      <div className="text-[10px] text-muted-foreground">{company.description}</div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Interview Type Selection */}
              <div className="space-y-3">
                <label className="text-sm font-medium">Interview Type</label>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {interviewTypes.map((type) => {
                    const Icon = type.icon;
                    return (
                      <button
                        key={type.id}
                        type="button"
                        onClick={() => setInterviewType(type.id)}
                        className={cn(
                          "flex flex-col items-center gap-2 p-4 rounded-lg border transition-all bg-background",
                          interviewType === type.id
                            ? "border-primary ring-1 ring-primary/30 bg-primary/5"
                            : "border-border hover:border-primary/50"
                        )}
                      >
                        <Icon className="w-6 h-6" />
                        <div className="text-center">
                          <div className="text-sm font-medium">{type.label}</div>
                          <div className="text-xs text-muted-foreground">
                            {type.description}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Session Configuration */}
              <div className="space-y-3">
                <label className="text-sm font-medium flex items-center gap-2">
                  <SlidersHorizontalIcon className="w-4 h-4" />
                  Session Settings
                </label>
                <div className="space-y-4 p-4 rounded-lg border border-border bg-muted/10">
                  <div className="space-y-2">
                    <label className="text-xs font-medium text-foreground">Questions</label>
                    <div className="flex flex-wrap items-center gap-2">
                      {[3, 5, 7, 10].map((n) => (
                        <button
                          key={n}
                          type="button"
                          onClick={() => setSessionConfig((c) => ({ ...c, questionCount: n }))}
                          className={optionPillClass(sessionConfig.questionCount === n)}
                        >
                          {n}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs font-medium text-foreground">Difficulty Focus</label>
                    <div className="flex flex-wrap items-center gap-2">
                      {(["mixed", "easy", "medium", "hard", "adaptive"] as const).map((d) => (
                        <button
                          key={d}
                          type="button"
                          onClick={() => setSessionConfig((c) => ({ ...c, difficultyFocus: d }))}
                          className={cn(optionPillClass(sessionConfig.difficultyFocus === d), "capitalize")}
                        >
                          {d}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="border-t border-border/60 pt-4 space-y-4">
                    <div className="flex items-center justify-between gap-4">
                      <label className="text-sm font-medium text-foreground">
                        Follow-up Questions
                      </label>
                      <Switch
                        checked={sessionConfig.enableFollowUps}
                        onCheckedChange={(checked) =>
                          setSessionConfig((c) => ({ ...c, enableFollowUps: checked }))
                        }
                      />
                    </div>
                    <div className="flex items-center justify-between gap-4">
                      <label className="text-sm font-medium text-foreground">
                        Countdown Timer
                      </label>
                      <Switch
                        checked={sessionConfig.enableCountdown}
                        onCheckedChange={(checked) =>
                          setSessionConfig((c) => ({ ...c, enableCountdown: checked }))
                        }
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* Interviewer Voice (TTS) */}
              <div className="space-y-3">
                <label className="text-sm font-medium flex items-center gap-2">
                  <Volume2Icon className="w-4 h-4" />
                  Conversational Interview
                </label>
                <div className="p-4 rounded-lg border border-border bg-muted/10 space-y-4">
                  <div className="flex items-center justify-between gap-4">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-foreground">Live interviewer voice</p>
                      <p className="text-xs text-muted-foreground">
                        The interviewer speaks questions and feedback — you respond by voice, like a real interview
                      </p>
                    </div>
                    <Switch
                      checked={ttsEnabled}
                      onCheckedChange={onTtsEnabledChange}
                      className="shrink-0"
                    />
                  </div>

                  {ttsEnabled && (
                    <>
                      <div className="space-y-2">
                        <label className="text-xs font-medium text-foreground">
                          Deepgram API Key
                        </label>
                        <input
                          type="password"
                          value={ttsApiKey}
                          onChange={(e) => onTtsApiKeyChange(e.target.value)}
                          placeholder="Enter your Deepgram API key..."
                          className="w-full px-3 py-2 text-sm rounded-md border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/30"
                        />
                      </div>

                      <div className="space-y-2">
                        <label className="text-xs font-medium text-foreground">
                          Interviewer Voice
                        </label>
                        <select
                          value={ttsModel}
                          onChange={(e) => onTtsModelChange(e.target.value)}
                          className="w-full px-3 py-2 text-sm rounded-md border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/30"
                        >
                          {DEEPGRAM_TTS_VOICES.map((voice) => (
                            <option key={voice.id} value={voice.id}>
                              {voice.label} — {voice.description}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="flex items-center gap-2">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={handleTestVoice}
                          disabled={
                            !ttsApiKey.trim() ||
                            isTestingVoice ||
                            isTtsSpeaking ||
                            isTtsLoading
                          }
                        >
                          {isTestingVoice || isTtsLoading ? (
                            <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />
                          ) : (
                            <Volume2Icon className="w-3.5 h-3.5 mr-1" />
                          )}
                          Test Voice
                        </Button>
                        {(isTtsSpeaking || isTtsLoading) && (
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            onClick={stopTts}
                          >
                            <VolumeXIcon className="w-3.5 h-3.5 mr-1" />
                            Stop
                          </Button>
                        )}
                      </div>

                      {ttsError && (
                        <p className="text-xs text-red-600 dark:text-red-400">{ttsError}</p>
                      )}
                    </>
                  )}
                </div>
              </div>

              {/* Resume Input */}
              <div className="space-y-2">
                <label className="text-sm font-medium flex items-center gap-2">
                  <FileTextIcon className="w-4 h-4" />
                  Resume / Background
                </label>
                <textarea
                  value={resume}
                  onChange={(e) => setResume(e.target.value)}
                  placeholder="Paste your resume or key background information..."
                  className="w-full h-32 px-3 py-2 text-sm rounded-md border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none"
                />
                {!resume.trim() && (
                  <p className="text-xs text-amber-700 dark:text-amber-400">
                    Add your resume for questions tailored to your experience — without it, questions stay generic.
                  </p>
                )}
                {resume.trim() && (
                  <p className="text-xs text-muted-foreground">
                    Saved automatically — shared with Interview Context in settings.
                  </p>
                )}
              </div>

              {/* Job Description Input */}
              <div className="space-y-2">
                <label className="text-sm font-medium flex items-center gap-2">
                  <BriefcaseIcon className="w-4 h-4" />
                  Job Description
                </label>
                <textarea
                  value={jobDescription}
                  onChange={(e) => setJobDescription(e.target.value)}
                  placeholder="Paste the job description to get tailored questions..."
                  className="w-full h-32 px-3 py-2 text-sm rounded-md border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none"
                />
                {!jobDescription.trim() && (
                  <p className="text-xs text-amber-700 dark:text-amber-400">
                    Paste the job description so questions align with the role you are preparing for.
                  </p>
                )}
                {jobDescription.trim() && (
                  <p className="text-xs text-muted-foreground">
                    Saved automatically — shared with Interview Context in settings.
                  </p>
                )}
              </div>

              {/* Question focus areas */}
              <div className="space-y-2">
                <label className="text-sm font-medium flex items-center gap-2">
                  <ClipboardListIcon className="w-4 h-4" />
                  Topics & Areas to Focus On
                </label>
                <textarea
                  value={questionFocusAreas}
                  onChange={(e) => setQuestionFocusAreas(e.target.value)}
                  placeholder={
                    "Tell the AI what to drill you on — one topic per line or free text.\n\nExamples:\n• System design for high-traffic APIs\n• STAR stories about leading cross-functional teams\n• SQL window functions and query optimization\n• Product trade-offs and prioritization frameworks"
                  }
                  className="w-full h-28 px-3 py-2 text-sm rounded-md border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/30 resize-y"
                />
                <p className="text-xs text-muted-foreground">
                  Optional. Questions will prioritize these areas alongside your resume and job description. Saved automatically.
                </p>
              </div>

              {error && (
                <div className="p-3 rounded-md bg-red-50 border border-red-200 text-red-800 text-sm">
                  {error}
                </div>
              )}

              <div className="h-24" />
            </div>
          )}

          {/* Question Preview Phase */}
          {phase === "question_preview" && session && (
            <div className="max-w-4xl mx-auto space-y-6">
              <div className="text-center space-y-2">
                <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-primary/10 mb-2">
                  <ListChecksIcon className="w-6 h-6 text-primary" />
                </div>
                <h3 className="text-xl font-semibold">Your Interview Questions</h3>
                <p className="text-sm text-muted-foreground max-w-lg mx-auto">
                  {session.resume || session.jobDescription
                    ? "These questions were generated from your resume and job description."
                    : "Add a resume and job description on setup for role-specific questions — this set is more generic."}
                  {session.questionFocusAreas?.trim()
                    ? " Your requested focus areas were included."
                    : ""}
                  {" "}Review them before you begin, or regenerate if they feel repetitive.
                </p>
              </div>

              <div className="flex flex-wrap items-center justify-center gap-2 text-xs">
                <span className="px-2 py-1 rounded-md bg-muted text-muted-foreground capitalize">
                  {session.type.replace(/_/g, " ")}
                </span>
                {session.targetCompany !== "generic" && (
                  <span className="px-2 py-1 rounded-md bg-muted text-muted-foreground capitalize">
                    {session.targetCompany}
                  </span>
                )}
                <span className="px-2 py-1 rounded-md bg-muted text-muted-foreground">
                  {session.questions.length} questions
                </span>
                {session.resume?.trim() && (
                  <span className="px-2 py-1 rounded-md bg-green-100 text-green-800 dark:bg-green-950/40 dark:text-green-300">
                    Resume used
                  </span>
                )}
                {session.jobDescription?.trim() && (
                  <span className="px-2 py-1 rounded-md bg-green-100 text-green-800 dark:bg-green-950/40 dark:text-green-300">
                    JD used
                  </span>
                )}
                {session.questionFocusAreas?.trim() && (
                  <span className="px-2 py-1 rounded-md bg-blue-100 text-blue-800 dark:bg-blue-950/40 dark:text-blue-300">
                    Focus areas used
                  </span>
                )}
              </div>

              {error && phase === "question_preview" && (
                <div className="p-3 rounded-md bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 text-red-800 dark:text-red-300 text-sm">
                  {error}
                </div>
              )}

              {regeneratingQuestions && (
                <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Generating a fresh question set...
                </div>
              )}

              <div className="space-y-3">
                {session.questions.map((q, idx) => (
                  <div
                    key={q.id}
                    className="p-4 rounded-lg border border-border bg-background space-y-2"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <p className="text-sm font-medium leading-relaxed">
                        <span className="text-muted-foreground mr-2">Q{idx + 1}.</span>
                        {q.question}
                      </p>
                      <span
                        className={cn(
                          "px-2 py-0.5 text-[10px] font-medium rounded shrink-0",
                          q.difficulty === "easy" && "bg-green-100 text-green-700",
                          q.difficulty === "medium" && "bg-yellow-100 text-yellow-700",
                          q.difficulty === "hard" && "bg-red-100 text-red-700"
                        )}
                      >
                        {q.difficulty}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[10px] px-2 py-0.5 rounded bg-muted text-muted-foreground">
                        {q.category}
                      </span>
                      {q.leadershipPrinciple && (
                        <span className="text-[10px] px-2 py-0.5 rounded bg-primary/10 text-primary">
                          LP: {q.leadershipPrinciple}
                        </span>
                      )}
                    </div>
                    {q.context && (
                      <p className="text-xs text-muted-foreground">{q.context}</p>
                    )}
                  </div>
                ))}
              </div>

              <div className="h-24" />
            </div>
          )}

          {/* Interview Phase */}
          {phase === "interview" && currentQuestion && (
            <div className="max-w-6xl mx-auto space-y-6">
              {ttsEnabled && ttsError && (
                <div className="p-3 rounded-md bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 text-red-800 dark:text-red-300 text-sm">
                  {ttsError}
                </div>
              )}
              {/* Question Card */}
              <div className="p-6 rounded-xl border-2 border-primary/20 bg-primary/5 shadow-sm">
                <div className="flex items-center gap-2 flex-wrap mb-3">
                  <span
                    className={cn(
                      "px-2 py-1 text-xs font-medium rounded",
                      currentQuestion.difficulty === "easy" && "bg-green-100 text-green-700",
                      currentQuestion.difficulty === "medium" && "bg-yellow-100 text-yellow-700",
                      currentQuestion.difficulty === "hard" && "bg-red-100 text-red-700"
                    )}
                  >
                    {currentQuestion.difficulty.toUpperCase()}
                  </span>
                  <span className="px-2 py-1 text-xs font-medium rounded bg-muted text-muted-foreground">
                    {currentQuestion.category}
                  </span>
                  {ttsEnabled && (isTtsSpeaking || isTtsLoading) && (
                    <span className="flex items-center gap-1.5 px-2 py-1 text-xs font-medium rounded bg-primary/10 text-primary">
                      <span className="flex gap-0.5 items-end h-3">
                        <span className="w-0.5 h-2 bg-primary rounded-full animate-pulse" />
                        <span className="w-0.5 h-3 bg-primary rounded-full animate-pulse [animation-delay:150ms]" />
                        <span className="w-0.5 h-1.5 bg-primary rounded-full animate-pulse [animation-delay:300ms]" />
                      </span>
                      Interviewer speaking...
                    </span>
                  )}
                  {ttsEnabled && !isTtsSpeaking && !isTtsLoading && isListening && (
                    <span className="flex items-center gap-1.5 px-2 py-1 text-xs font-medium rounded bg-red-500/10 text-red-600 dark:text-red-400">
                      <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                      Your turn — speak now
                    </span>
                  )}
                </div>
                <h3 className="text-lg font-semibold text-foreground">
                  {currentQuestion.question}
                </h3>
                {currentQuestion.context && (
                  <p className="text-sm text-muted-foreground mt-2">{currentQuestion.context}</p>
                )}
              </div>

              {/* Main Grid: Answer + Coaching Sidebar */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Left: Answer Recording */}
                <div className="lg:col-span-2 space-y-4">
                  <div className="p-5 rounded-xl border border-border bg-muted/30 shadow-sm space-y-4">
                    <div className="flex items-center justify-between">
                      <h4 className="text-sm font-semibold">Your Answer</h4>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => setUseTextInput(!useTextInput)}
                          className={cn(
                            "flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-medium transition-colors",
                            useTextInput ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground hover:bg-muted/80"
                          )}
                        >
                          <PenLineIcon className="w-3 h-3" />
                          {useTextInput ? "Typing" : "Type instead"}
                        </button>
                        {!useTextInput && (
                          <>
                            {ttsEnabled ? (
                              isListening ? (
                                <Button
                                  onClick={handleStopAnswer}
                                  size="sm"
                                  variant="destructive"
                                  className="animate-pulse"
                                >
                                  <MicIcon className="w-4 h-4 mr-2" />
                                  Done Speaking
                                </Button>
                              ) : (
                                <span className="text-[10px] text-muted-foreground px-2">
                                  {isTtsSpeaking || isTtsLoading
                                    ? "Listen to the interviewer..."
                                    : "Mic opens automatically after each question"}
                                </span>
                              )
                            ) : !isListening ? (
                              <Button
                                onClick={handleStartAnswer}
                                size="sm"
                                variant="default"
                              >
                                <MicIcon className="w-4 h-4 mr-2" />
                                Start Speaking
                              </Button>
                            ) : (
                              <Button
                                onClick={handleStopAnswer}
                                size="sm"
                                variant="destructive"
                                className="animate-pulse"
                              >
                                <MicIcon className="w-4 h-4 mr-2" />
                                Stop Recording
                              </Button>
                            )}
                          </>
                        )}
                      </div>
                    </div>

                    {useTextInput ? (
                      <textarea
                        value={textAnswer}
                        onChange={(e) => setTextAnswer(e.target.value)}
                        placeholder="Type your answer here... Use the framework shown on the right as a guide."
                        className="w-full min-h-40 p-4 rounded-md border border-border bg-background text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-primary/30 resize-y"
                      />
                    ) : (
                      <div className="min-h-40 p-4 rounded-md border border-border bg-background">
                        {isListening && (
                          <div className="flex items-center gap-2 mb-3 text-xs text-muted-foreground">
                            <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                            Recording... Speak clearly and confidently
                          </div>
                        )}
                        <p className="text-sm whitespace-pre-wrap leading-relaxed">
                          {currentTranscript || answerDraft || (
                            <span className="text-muted-foreground">
                              Your answer will appear here as you speak...
                            </span>
                          )}
                        </p>
                      </div>
                    )}

                    {error && (
                      <div className="p-2 rounded-md bg-red-50 border border-red-200 text-red-800 text-xs">
                        {error}
                      </div>
                    )}
                  </div>

                  {/* Live Performance Metrics */}
                  <LivePerformanceMetrics
                    transcript={currentTranscript || answerDraft}
                    expectedKeyPoints={currentQuestion.expectedKeyPoints || []}
                    answerSeconds={answerSeconds}
                    isListening={isListening}
                  />

                  <div className="h-20" />
                </div>

                {/* Right: Coaching Sidebar */}
                <div className="lg:col-span-1">
                  <div className="sticky top-4 space-y-4">
                    {/* Answer Timer / Countdown */}
                    {(isListening || answerSeconds > 0 || useTextInput) && (
                      <div className="rounded-xl border border-border bg-background p-4 shadow-sm">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-1">
                            {session?.config.enableCountdown ? <TimerIcon className="w-3 h-3" /> : null}
                            {session?.config.enableCountdown ? "Countdown" : "Answer Time"}
                          </span>
                          {isListening && (
                            <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                          )}
                        </div>
                        {session?.config.enableCountdown ? (() => {
                          const limit = COUNTDOWN_DEFAULTS[session.type] || 120;
                          const remaining = Math.max(0, limit - answerSeconds);
                          const pct = remaining / limit;
                          return (
                            <>
                              <div className={cn(
                                "text-3xl font-bold tabular-nums",
                                pct > 0.25 ? "text-foreground" : pct > 0 ? "text-amber-500" : "text-red-500"
                              )}>
                                {Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2, "0")}
                              </div>
                              <div className="w-full h-1.5 bg-muted rounded-full mt-2 overflow-hidden">
                                <div
                                  className={cn(
                                    "h-full rounded-full transition-all duration-1000",
                                    pct > 0.25 ? "bg-primary" : pct > 0 ? "bg-amber-500" : "bg-red-500"
                                  )}
                                  style={{ width: `${pct * 100}%` }}
                                />
                              </div>
                              <p className="text-[10px] text-muted-foreground mt-1">
                                {remaining === 0 ? "Time's up — wrap up now" : remaining < 30 ? "Almost out of time" : "Stay on pace"}
                              </p>
                            </>
                          );
                        })() : (
                          <>
                            <div className="text-3xl font-bold tabular-nums text-foreground">
                              {Math.floor(answerSeconds / 60)}:{String(answerSeconds % 60).padStart(2, "0")}
                            </div>
                            <p className="text-[10px] text-muted-foreground mt-1">
                              {answerSeconds < 30
                                ? "Keep going — aim for 1-3 minutes"
                                : answerSeconds < 90
                                  ? "Good pace — add detail if needed"
                                  : answerSeconds < 180
                                    ? "Solid length — start wrapping up"
                                    : "Consider wrapping up soon"}
                            </p>
                          </>
                        )}
                      </div>
                    )}

                    {/* Key Points — shown as a hint toggle */}
                    {currentQuestion.expectedKeyPoints && currentQuestion.expectedKeyPoints.length > 0 && (
                      <KeyPointsHint
                        points={currentQuestion.expectedKeyPoints}
                        transcript={currentTranscript || answerDraft}
                      />
                    )}

                    {/* Answer Structure Guide */}
                    <AnswerStructureGuide
                      interviewType={session?.type || interviewType}
                      isListening={isListening}
                      answerSeconds={answerSeconds}
                    />
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Follow-Up Phase */}
          {phase === "follow_up" && followUpQuestion && (
            <div className="max-w-5xl mx-auto space-y-6">
              <div className="p-5 rounded-xl border-2 border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-950/30 shadow-sm space-y-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <MessageCircleQuestionIcon className="w-5 h-5 text-amber-600 dark:text-amber-400" />
                  <h3 className="text-sm font-semibold text-amber-800 dark:text-amber-300">Follow-Up Question</h3>
                  {ttsEnabled && (isTtsSpeaking || isTtsLoading) && (
                    <span className="flex items-center gap-1 text-[10px] text-amber-700 dark:text-amber-400">
                      <Loader2 className="w-3 h-3 animate-spin" />
                      Interviewer speaking...
                    </span>
                  )}
                  {ttsEnabled && !isTtsSpeaking && !isTtsLoading && isListening && (
                    <span className="flex items-center gap-1 text-[10px] text-red-600 dark:text-red-400">
                      <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
                      Your turn — speak now
                    </span>
                  )}
                </div>
                <p className="text-xs text-amber-700/80 dark:text-amber-400/80">
                  Personalized from your previous answer — the interviewer is probing a gap or weak spot.
                </p>
                <p className="text-base font-medium">{followUpQuestion}</p>
              </div>

              <div className="p-5 rounded-xl border border-border bg-muted/30 shadow-sm space-y-4">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-semibold">Your Follow-Up Answer</h4>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setFollowUpUseTextInput(!followUpUseTextInput)}
                      className={cn(
                        "flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-medium transition-colors",
                        followUpUseTextInput
                          ? "bg-primary/10 text-primary"
                          : "bg-muted text-muted-foreground hover:bg-muted/80"
                      )}
                    >
                      <PenLineIcon className="w-3 h-3" />
                      {followUpUseTextInput ? "Typing" : "Type instead"}
                    </button>
                    {!followUpUseTextInput && (
                      <>
                        {ttsEnabled ? (
                          isListening ? (
                            <Button
                              onClick={handleStopFollowUpAnswer}
                              size="sm"
                              variant="destructive"
                              className="animate-pulse"
                            >
                              <MicIcon className="w-4 h-4 mr-2" />
                              Done Speaking
                            </Button>
                          ) : (
                            <span className="text-[10px] text-muted-foreground px-2">
                              {isTtsSpeaking || isTtsLoading
                                ? "Listen to the interviewer..."
                                : "Mic opens automatically after the question"}
                            </span>
                          )
                        ) : !isListening ? (
                          <Button
                            onClick={handleStartFollowUpAnswer}
                            size="sm"
                            variant="default"
                            disabled={isTtsSpeaking || isTtsLoading}
                          >
                            <MicIcon className="w-4 h-4 mr-2" />
                            Start Speaking
                          </Button>
                        ) : (
                          <Button
                            onClick={handleStopFollowUpAnswer}
                            size="sm"
                            variant="destructive"
                            className="animate-pulse"
                          >
                            <MicIcon className="w-4 h-4 mr-2" />
                            Stop Recording
                          </Button>
                        )}
                      </>
                    )}
                  </div>
                </div>

                {followUpUseTextInput ? (
                  <textarea
                    value={followUpAnswer}
                    onChange={(e) => setFollowUpAnswer(e.target.value)}
                    placeholder="Type your follow-up answer..."
                    className="w-full min-h-32 p-4 rounded-md border border-border bg-background text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-primary/30 resize-y"
                  />
                ) : (
                  <div className="min-h-32 p-4 rounded-md border border-border bg-background">
                    {isListening && (
                      <div className="flex items-center gap-2 mb-3 text-xs text-muted-foreground">
                        <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                        Recording... Speak clearly and confidently
                      </div>
                    )}
                    <p className="text-sm whitespace-pre-wrap leading-relaxed">
                      {currentTranscript || followUpAnswer || (
                        <span className="text-muted-foreground">
                          Your follow-up answer will appear here as you speak...
                        </span>
                      )}
                    </p>
                  </div>
                )}
              </div>

              <div className="h-24" />
            </div>
          )}

          {/* Coaching Phase — Tabbed Layout */}
          {phase === "coaching" && coachingFeedback && currentQuestion && (
            <div className="max-w-5xl mx-auto space-y-4">
              {/* Score Ring */}
              <div className="flex items-center gap-6 p-4 rounded-lg border border-border bg-muted/10">
                <div className="relative w-20 h-20 shrink-0">
                  <svg className="w-full h-full -rotate-90" viewBox="0 0 100 100">
                    <circle cx="50" cy="50" r="40" fill="none" className="stroke-muted/40" strokeWidth="8" />
                    <circle cx="50" cy="50" r="40" fill="none"
                      className={cn(
                        coachingFeedback.score >= 80 && "stroke-green-500",
                        coachingFeedback.score >= 60 && coachingFeedback.score < 80 && "stroke-yellow-500",
                        coachingFeedback.score < 60 && "stroke-red-500",
                      )}
                      strokeWidth="8" strokeLinecap="round"
                      strokeDasharray={`${2 * Math.PI * 40}`}
                      strokeDashoffset={`${2 * Math.PI * 40 * (1 - coachingFeedback.score / 100)}`}
                    />
                  </svg>
                  <div className="absolute inset-0 flex items-center justify-center">
                    <span className="text-xl font-bold tabular-nums">{coachingFeedback.score}</span>
                  </div>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="prose prose-sm max-w-none dark:prose-invert">
                    <Markdown>{coachingFeedback.faangComparison}</Markdown>
                  </div>
                  {ttsEnabled && (isTtsSpeaking || isTtsLoading) && (
                    <p className="text-xs text-primary mt-2 flex items-center gap-1.5">
                      <Loader2 className="w-3 h-3 animate-spin" />
                      Interviewer is giving verbal feedback...
                    </p>
                  )}
                  {coachingFeedback.companySpecificNotes && (
                    <p className="text-xs text-primary mt-2">{coachingFeedback.companySpecificNotes}</p>
                  )}
                </div>
              </div>

              {/* Tabs */}
              <div className="flex border-b border-border gap-0">
                {([
                  { id: "score" as const, label: "Feedback" },
                  { id: "model" as const, label: "Model Answers (L4–L6)" },
                  { id: "next" as const, label: "Next Steps" },
                ]).map((tab) => (
                  <button
                    key={tab.id}
                    onClick={() => setCoachingTab(tab.id)}
                    className={cn(
                      "px-4 py-2 text-sm font-medium border-b-2 transition-colors",
                      coachingTab === tab.id
                        ? "border-primary text-primary"
                        : "border-transparent text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              {/* Tab Content */}
              {coachingTab === "score" && (
                <div className="space-y-4">
                  {/* Your Transcript */}
                  {session?.answers && session.answers.length > 0 && (
                    <div className="p-4 rounded-lg border border-border bg-muted/10">
                      <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">What You Said</h4>
                      <p className="text-sm text-foreground/80 italic leading-relaxed max-h-32 overflow-y-auto">
                        "{session.answers[session.answers.length - 1]?.transcriptText}"
                      </p>
                    </div>
                  )}

                  {coachingFeedback.strengths.length > 0 && (
                    <div className="p-4 rounded-lg border border-green-200 bg-green-50 dark:bg-green-950 space-y-2">
                      <h4 className="text-sm font-semibold flex items-center gap-2 text-green-700 dark:text-green-400">
                        <CheckIcon className="w-4 h-4" />
                        Strengths
                      </h4>
                      <ul className="list-disc list-inside text-sm text-green-800 dark:text-green-300 space-y-1">
                        {coachingFeedback.strengths.map((s, i) => <li key={i}>{s}</li>)}
                      </ul>
                    </div>
                  )}

                  {coachingFeedback.improvements.length > 0 && (
                    <div className="p-4 rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-950 space-y-2">
                      <h4 className="text-sm font-semibold flex items-center gap-2 text-amber-700 dark:text-amber-400">
                        <SparklesIcon className="w-4 h-4" />
                        Areas for Improvement
                      </h4>
                      <ul className="list-disc list-inside text-sm text-amber-800 dark:text-amber-300 space-y-1">
                        {coachingFeedback.improvements.map((s, i) => <li key={i}>{s}</li>)}
                      </ul>
                    </div>
                  )}
                </div>
              )}

              {coachingTab === "model" && (() => {
                const levelAnswers = resolveModelAnswers(coachingFeedback);
                const activeAnswer = levelAnswers[modelLevel];
                const hasAnyAnswer = INTERVIEW_LEVELS.some((level) => levelAnswers[level]?.trim());

                return (
                  <div className="space-y-4">
                    {hasAnyAnswer ? (
                      <>
                        <div className="space-y-2">
                          <p className="text-xs text-muted-foreground">
                            Compare how the same question is answered at different levels — notice scope, depth, and impact.
                          </p>
                          <div className="flex flex-wrap gap-2">
                            {INTERVIEW_LEVELS.map((level) => {
                              const meta = INTERVIEW_LEVEL_GUIDE[level];
                              const available = Boolean(levelAnswers[level]?.trim());
                              return (
                                <button
                                  key={level}
                                  type="button"
                                  onClick={() => setModelLevel(level)}
                                  disabled={!available}
                                  className={cn(
                                    "px-3 py-1.5 rounded-full text-xs font-semibold transition-colors border",
                                    modelLevel === level && available
                                      ? cn(meta.pillClass, "border-current shadow-sm")
                                      : available
                                        ? "border-border bg-muted/40 text-foreground hover:bg-muted"
                                        : "border-border bg-muted/20 text-muted-foreground cursor-not-allowed opacity-50"
                                  )}
                                >
                                  {meta.label} · {meta.title}
                                </button>
                              );
                            })}
                          </div>
                          <p className="text-xs text-muted-foreground">
                            {INTERVIEW_LEVEL_GUIDE[modelLevel].description}
                          </p>
                        </div>

                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                          <div className="p-4 rounded-lg border border-border bg-muted/10 space-y-2">
                            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                              Your Answer
                            </h4>
                            <p className="text-sm text-foreground/80 leading-relaxed whitespace-pre-wrap">
                              {session?.answers[session.answers.length - 1]?.transcriptText}
                            </p>
                          </div>
                          <div
                            className={cn(
                              "p-4 rounded-lg border-2 space-y-2",
                              modelLevel === "L4" && "border-sky-300/60 bg-sky-50/50 dark:bg-sky-950/20",
                              modelLevel === "L5" && "border-primary/30 bg-primary/5",
                              modelLevel === "L6" && "border-violet-300/60 bg-violet-50/50 dark:bg-violet-950/20"
                            )}
                          >
                            <h4 className="text-xs font-semibold uppercase tracking-wide flex items-center gap-1">
                              <SparklesIcon className="w-3 h-3" />
                              {INTERVIEW_LEVEL_GUIDE[modelLevel].label} Model —{" "}
                              {INTERVIEW_LEVEL_GUIDE[modelLevel].title}
                            </h4>
                            <div className="prose prose-sm max-w-none dark:prose-invert">
                              {activeAnswer ? (
                                <Markdown>{activeAnswer}</Markdown>
                              ) : (
                                <p className="text-sm text-muted-foreground">
                                  No {modelLevel} model answer returned. Try submitting again.
                                </p>
                              )}
                            </div>
                          </div>
                        </div>
                      </>
                    ) : (
                      <p className="text-sm text-muted-foreground text-center py-8">
                        No model answers available for this question.
                      </p>
                    )}
                  </div>
                );
              })()}

              {coachingTab === "next" && (
                <div className="space-y-4">
                  {coachingFeedback.nextSteps.length > 0 && (
                    <div className="p-4 rounded-lg border border-border bg-background space-y-2">
                      <h4 className="text-sm font-semibold">Actionable Next Steps</h4>
                      <ol className="list-decimal list-inside text-sm text-muted-foreground space-y-2">
                        {coachingFeedback.nextSteps.map((step, idx) => (
                          <li key={idx} className="leading-relaxed">{step}</li>
                        ))}
                      </ol>
                    </div>
                  )}
                  {currentQuestion.leadershipPrinciple && (
                    <div className="p-3 rounded-lg border border-primary/20 bg-primary/5">
                      <p className="text-xs font-semibold text-primary">Amazon LP: {currentQuestion.leadershipPrinciple}</p>
                      <p className="text-xs text-muted-foreground mt-1">Focus on demonstrating this principle with specific, measurable examples in your next attempt.</p>
                    </div>
                  )}
                </div>
              )}

              <div className="h-24" />
            </div>
          )}

          {/* Complete Phase */}
          {phase === "complete" && session && (
            <div className="max-w-5xl mx-auto space-y-8 text-center">
              <div className="space-y-4">
                <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-primary/10">
                  <TrophyIcon className="w-10 h-10 text-primary" />
                </div>
                <h3 className="text-2xl font-bold">Interview Complete!</h3>
                <p className="text-muted-foreground">
                  Great job! Here's your overall performance summary.
                </p>
              </div>

              <div className="p-6 rounded-lg border-2 border-primary/20 bg-primary/5">
                <div className="text-4xl font-bold text-primary mb-2">
                  {session.overallScore.toFixed(0)}/100
                </div>
                <p className="text-sm text-muted-foreground">
                  Overall Interview Score
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="p-4 rounded-lg border border-border bg-background">
                  <div className="text-2xl font-bold">{session.questions.length}</div>
                  <div className="text-xs text-muted-foreground">
                    Questions Answered
                  </div>
                </div>
                <div className="p-4 rounded-lg border border-border bg-background">
                  <div className="text-2xl font-bold">
                    {session.answers.filter((a) => a.coaching.score >= 80).length}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Strong Answers
                  </div>
                </div>
                <div className="p-4 rounded-lg border border-border bg-background">
                  <div className="text-2xl font-bold">
                    {session.answers.filter((a) => a.coaching.score < 60).length}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Need Improvement
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                {session.answers.map((answer, idx) => {
                  const question = session.questions.find(
                    (q) => q.id === answer.questionId
                  );
                  return (
                    <div
                      key={answer.questionId}
                      className="p-4 rounded-lg border border-border bg-background text-left"
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1">
                          <p className="text-sm font-medium mb-1">
                            Q{idx + 1}: {question?.question}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {answer.coaching.strengths[0]}
                          </p>
                        </div>
                        <div
                          className={cn(
                            "px-3 py-1 rounded-full text-sm font-semibold",
                            answer.coaching.score >= 80 &&
                              "bg-green-100 text-green-700",
                            answer.coaching.score >= 60 &&
                              answer.coaching.score < 80 &&
                              "bg-yellow-100 text-yellow-700",
                            answer.coaching.score < 60 && "bg-red-100 text-red-700"
                          )}
                        >
                          {answer.coaching.score}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="flex gap-3">
                <Button onClick={() => setPhase("history")} variant="outline" size="lg" className="flex-1">
                  <HistoryIcon className="w-4 h-4 mr-2" />
                  View History
                </Button>
                <Button onClick={handleRestart} className="flex-1" size="lg">
                  <RefreshCwIcon className="w-4 h-4 mr-2" />
                  New Interview
                </Button>
              </div>
            </div>
          )}
        </div>
      </ScrollArea>

      {/* Sticky footer — always visible action buttons */}
      {phase === "interview" && currentQuestion && (
        <div className="flex-shrink-0 border-t border-border/50 bg-background/95 backdrop-blur-sm px-8 py-4">
          <div className="max-w-5xl mx-auto flex gap-3">
            <Button
              onClick={handleSkipQuestion}
              variant="outline"
              size="lg"
              className="flex-1"
              disabled={isSubmitting || isListening}
            >
              <SkipForwardIcon className="w-4 h-4 mr-2" />
              Skip Question
            </Button>
            <Button
              onClick={handleSubmitCurrentAnswer}
              disabled={
                isSubmitting ||
                (useTextInput ? !textAnswer.trim() : (!currentTranscript && !answerDraft)) ||
                (!useTextInput && isListening)
              }
              className="flex-[2]"
              size="lg"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Getting Feedback...
                </>
              ) : (
                <>
                  <SparklesIcon className="w-4 h-4 mr-2" />
                  Get FAANG-Level Coaching
                </>
              )}
            </Button>
          </div>
        </div>
      )}

      {phase === "question_preview" && session && (
        <div className="flex-shrink-0 border-t border-border/50 bg-background/95 backdrop-blur-sm px-8 py-4">
          <div className="max-w-4xl mx-auto flex gap-3">
            <Button
              onClick={handleBackToSetup}
              variant="outline"
              size="lg"
              className="flex-1"
              disabled={regeneratingQuestions}
            >
              Back to Setup
            </Button>
            <Button
              onClick={handleRegenerateQuestions}
              variant="outline"
              size="lg"
              className="flex-1"
              disabled={regeneratingQuestions}
            >
              {regeneratingQuestions ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Regenerating...
                </>
              ) : (
                <>
                  <RefreshCwIcon className="w-4 h-4 mr-2" />
                  Regenerate
                </>
              )}
            </Button>
            <Button
              onClick={handleBeginInterview}
              size="lg"
              className="flex-[2]"
              disabled={regeneratingQuestions}
            >
              <PlayIcon className="w-4 h-4 mr-2" />
              Begin Interview
            </Button>
          </div>
        </div>
      )}

      {phase === "follow_up" && (
        <div className="flex-shrink-0 border-t border-border/50 bg-background/95 backdrop-blur-sm px-8 py-4">
          <div className="max-w-5xl mx-auto flex gap-3">
            <Button onClick={() => setPhase("coaching")} variant="outline" size="lg" className="flex-1">
              Skip Follow-Up
            </Button>
            <Button
              onClick={handleSubmitFollowUp}
              disabled={
                followUpUseTextInput
                  ? !followUpAnswer.trim()
                  : !(currentTranscript.trim() || followUpAnswer.trim()) || isListening
              }
              size="lg"
              className="flex-1"
            >
              Submit Follow-Up
            </Button>
          </div>
        </div>
      )}

      {phase === "setup" && (
        <div className="flex-shrink-0 border-t border-border/50 bg-background/95 backdrop-blur-sm px-8 py-4">
          <div className="max-w-4xl mx-auto flex justify-center">
            <Button
              onClick={handleStartInterview}
              disabled={loading}
              className="w-full max-w-md mx-auto"
              size="lg"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Generating Questions...
                </>
              ) : (
                <>
                  <SparklesIcon className="w-4 h-4 mr-2" />
                  Generate Questions
                </>
              )}
            </Button>
          </div>
        </div>
      )}

      {phase === "coaching" && coachingFeedback && (
        <div className="flex-shrink-0 border-t border-border/50 bg-background/95 backdrop-blur-sm px-8 py-4">
          <div className="max-w-5xl mx-auto flex gap-3">
            <Button
              onClick={handleRetryQuestion}
              variant="outline"
              size="lg"
              className="flex-1"
            >
              <RefreshCwIcon className="w-4 h-4 mr-2" />
              Retry
            </Button>
            {session?.config.enableFollowUps && onGenerateFollowUp && (
              <Button
                onClick={handleFollowUp}
                variant="outline"
                size="lg"
                className="flex-1"
                disabled={followUpLoading}
              >
                {followUpLoading ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <MessageCircleQuestionIcon className="w-4 h-4 mr-2" />
                )}
                Follow-Up
              </Button>
            )}
            <Button onClick={handleNextQuestion} size="lg" className="flex-1">
              {session && session.currentQuestionIndex >= session.questions.length - 1 ? (
                <>
                  <CheckIcon className="w-4 h-4 mr-2" />
                  Complete
                </>
              ) : (
                <>
                  Next Question
                  <PlayIcon className="w-4 h-4 ml-2" />
                </>
              )}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};

// Key points hint — revealed on demand, not shown by default
function KeyPointsHint({ points, transcript }: { points: string[]; transcript: string }) {
  const [revealed, setRevealed] = useState(false);

  const coveredCount = useMemo(() => {
    const t = transcript.toLowerCase();
    return points.filter((point) => {
      const keywords = point.toLowerCase().split(/\s+/).filter((w) => w.length > 4);
      return keywords.length > 0 && keywords.some((kw) => t.includes(kw));
    }).length;
  }, [points, transcript]);

  return (
    <div className="rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-950/30 p-4 shadow-sm">
      <button
        type="button"
        onClick={() => setRevealed((v) => !v)}
        className="w-full flex items-center justify-between gap-2"
      >
        <span className="text-xs font-semibold text-amber-800 dark:text-amber-300 uppercase tracking-wide">
          💡 Need a hint?
        </span>
        <span className="text-[10px] text-amber-700 dark:text-amber-400 font-medium">
          {revealed ? "Hide" : `Show ${points.length} key points`}
        </span>
      </button>

      {revealed && (
        <ul className="mt-3 space-y-2">
          {points.map((point, idx) => {
            const t = transcript.toLowerCase();
            const keywords = point.toLowerCase().split(/\s+/).filter((w) => w.length > 4);
            const covered = keywords.length > 0 && keywords.some((kw) => t.includes(kw));
            return (
              <li key={idx} className="flex items-start gap-2">
                <span
                  className={cn(
                    "mt-0.5 flex-shrink-0 w-4 h-4 rounded-full border-2 flex items-center justify-center transition-colors",
                    covered ? "border-green-500 bg-green-500" : "border-amber-300 dark:border-amber-600"
                  )}
                >
                  {covered && <CheckIcon className="w-2.5 h-2.5 text-white" />}
                </span>
                <span className={cn("text-xs leading-tight", covered ? "text-foreground font-medium" : "text-amber-800 dark:text-amber-300")}>
                  {point}
                </span>
              </li>
            );
          })}
        </ul>
      )}

      {!revealed && transcript.length > 0 && (
        <p className="mt-2 text-[10px] text-amber-700 dark:text-amber-400">
          {coveredCount}/{points.length} points covered so far
        </p>
      )}
    </div>
  );
}

// Live performance metrics — heuristic scoring based on transcript content
function LivePerformanceMetrics({
  transcript,
  expectedKeyPoints,
  answerSeconds,
  isListening: _isListening,
}: {
  transcript: string;
  expectedKeyPoints: string[];
  answerSeconds: number;
  isListening: boolean;
}) {
  const metrics = useMemo(() => {
    if (!transcript.trim()) return null;

    const words = transcript.trim().split(/\s+/);
    const wordCount = words.length;
    const sentences = transcript.split(/[.!?]+/).filter((s) => s.trim().length > 0);
    const avgSentenceLen = sentences.length > 0 ? wordCount / sentences.length : 0;

    // Relevance — how many expected key points are touched
    const relevanceHits = expectedKeyPoints.filter((point) => {
      const keywords = point.toLowerCase().split(/\s+/).filter((w) => w.length > 4);
      return keywords.length > 0 && keywords.some((kw) => transcript.toLowerCase().includes(kw));
    });
    const relevance = expectedKeyPoints.length > 0
      ? Math.round((relevanceHits.length / expectedKeyPoints.length) * 100)
      : 50;

    // Structure — presence of transition words, logical flow signals
    const structureWords = ["first", "second", "then", "next", "finally", "because", "therefore", "however", "for example", "specifically", "as a result", "in addition"];
    const structureHits = structureWords.filter((w) => transcript.toLowerCase().includes(w));
    const structure = Math.min(100, Math.round((structureHits.length / 4) * 100));

    // Conciseness — penalize if too wordy or too short
    let conciseness = 70;
    if (answerSeconds > 0) {
      const wordsPerMin = (wordCount / answerSeconds) * 60;
      if (wordsPerMin >= 120 && wordsPerMin <= 160) conciseness = 90;
      else if (wordsPerMin >= 100 && wordsPerMin <= 180) conciseness = 75;
      else if (wordsPerMin > 180) conciseness = 50; // too fast / rambling
      else conciseness = 60; // too slow
    }
    // Also penalize very long average sentences
    if (avgSentenceLen > 25) conciseness = Math.max(40, conciseness - 20);

    // Confidence — heuristic: fewer filler words = higher confidence
    const fillers = ["um", "uh", "like", "you know", "basically", "actually", "sort of", "kind of", "i think", "i guess", "maybe"];
    const fillerCount = fillers.reduce((count, filler) => {
      const regex = new RegExp(`\\b${filler}\\b`, "gi");
      return count + (transcript.match(regex)?.length || 0);
    }, 0);
    const fillerRatio = wordCount > 0 ? fillerCount / wordCount : 0;
    const confidence = Math.max(30, Math.round(100 - fillerRatio * 500));

    // Depth — word count relative to time, shows engagement
    const depth = Math.min(100, Math.round(Math.min(wordCount / 2, 100)));

    return { relevance, structure, conciseness, confidence, depth };
  }, [transcript, expectedKeyPoints, answerSeconds]);

  if (!metrics) return null;

  const metricsList = [
    { label: "Relevance", value: metrics.relevance, hint: "Covering key points" },
    { label: "Structure", value: metrics.structure, hint: "Logical flow & transitions" },
    { label: "Conciseness", value: metrics.conciseness, hint: "Clear, not rambling" },
    { label: "Confidence", value: metrics.confidence, hint: "Minimal filler words" },
    { label: "Depth", value: metrics.depth, hint: "Sufficient detail" },
  ];

  return (
    <div className="rounded-xl border border-border bg-background p-5 shadow-sm">
      <p className="text-xs font-semibold text-foreground mb-4 uppercase tracking-wide">
        Live Performance
      </p>
      <div className="space-y-3">
        {metricsList.map((m) => (
          <div key={m.label}>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-medium text-foreground">{m.label}</span>
              <span className="text-xs font-bold tabular-nums text-foreground">{m.value}</span>
            </div>
            <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
              <div
                className={cn(
                  "h-full rounded-full transition-all duration-500",
                  m.value >= 75 && "bg-green-500",
                  m.value >= 50 && m.value < 75 && "bg-yellow-500",
                  m.value < 50 && "bg-red-500"
                )}
                style={{ width: `${m.value}%` }}
              />
            </div>
            <p className="text-[9px] text-muted-foreground mt-0.5">{m.hint}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

// Answer structure guide component — shows interview-type-specific framework
function AnswerStructureGuide({
  interviewType,
  isListening,
  answerSeconds,
}: {
  interviewType: InterviewType;
  isListening: boolean;
  answerSeconds: number;
}) {
  const structures: Record<InterviewType, { title: string; steps: { label: string; time: string }[] }> = {
    behavioral: {
      title: "STAR Method",
      steps: [
        { label: "Situation — Set the context", time: "0:00–0:30" },
        { label: "Task — What was your responsibility", time: "0:30–0:45" },
        { label: "Action — What you specifically did", time: "0:45–1:30" },
        { label: "Result — Quantifiable outcome", time: "1:30–2:00" },
      ],
    },
    technical: {
      title: "Technical Framework",
      steps: [
        { label: "Clarify — Restate & ask questions", time: "0:00–0:20" },
        { label: "Approach — Explain your thinking", time: "0:20–0:50" },
        { label: "Deep-dive — Technical details", time: "0:50–1:40" },
        { label: "Trade-offs — Alternatives & why", time: "1:40–2:00" },
      ],
    },
    system_design: {
      title: "System Design Framework",
      steps: [
        { label: "Requirements — Functional & non-functional", time: "0:00–1:00" },
        { label: "High-level design — Components & data flow", time: "1:00–3:00" },
        { label: "Deep-dive — Key components in detail", time: "3:00–5:00" },
        { label: "Scaling & trade-offs", time: "5:00–6:00" },
      ],
    },
    coding: {
      title: "Coding Framework",
      steps: [
        { label: "Understand — Clarify inputs/outputs/edge cases", time: "0:00–0:30" },
        { label: "Plan — Brute force → optimal approach", time: "0:30–1:00" },
        { label: "Implement — Talk through your code", time: "1:00–2:30" },
        { label: "Test — Walk through examples", time: "2:30–3:00" },
      ],
    },
    product_management: {
      title: "PM Framework",
      steps: [
        { label: "Clarify — Goals, users, constraints", time: "0:00–0:30" },
        { label: "Structure — Framework or prioritization", time: "0:30–1:00" },
        { label: "Analyze — Metrics, trade-offs, data", time: "1:00–2:00" },
        { label: "Recommend — Clear decision + next steps", time: "2:00–2:30" },
      ],
    },
    program_management: {
      title: "PgM Framework",
      steps: [
        { label: "Context — Scope, teams, timeline", time: "0:00–0:30" },
        { label: "Approach — How you coordinated", time: "0:30–1:00" },
        { label: "Challenges — Risks & how you mitigated", time: "1:00–1:45" },
        { label: "Outcome — Delivered on time + learnings", time: "1:45–2:15" },
      ],
    },
    general: {
      title: "Answer Structure",
      steps: [
        { label: "Hook — Lead with the key point", time: "0:00–0:15" },
        { label: "Context — Brief background", time: "0:15–0:30" },
        { label: "Details — Specific examples", time: "0:30–1:30" },
        { label: "Wrap-up — Summarize & connect to role", time: "1:30–2:00" },
      ],
    },
  };

  const guide = structures[interviewType] || structures.general;

  // Determine which step the user is currently in based on time
  const currentStepIndex = useMemo(() => {
    if (!isListening) return -1;
    const timeRanges = guide.steps.map((s) => {
      const [start] = s.time.split("–");
      const [m, sec] = start.split(":").map(Number);
      return m * 60 + sec;
    });
    for (let i = timeRanges.length - 1; i >= 0; i--) {
      if (answerSeconds >= timeRanges[i]) return i;
    }
    return 0;
  }, [answerSeconds, isListening, guide.steps]);

  return (
    <div className="rounded-xl border border-border bg-background p-4 shadow-sm">
      <p className="text-xs font-semibold text-foreground mb-3 uppercase tracking-wide">
        {guide.title}
      </p>
      <ol className="space-y-2">
        {guide.steps.map((step, idx) => {
          const isActive = idx === currentStepIndex;
          const isPast = idx < currentStepIndex;
          return (
            <li
              key={idx}
              className={cn(
                "flex items-start gap-2 p-2 rounded-md transition-colors",
                isActive && "bg-primary/10 border border-primary/30",
                isPast && "opacity-50"
              )}
            >
              <span
                className={cn(
                  "flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold mt-0.5",
                  isActive
                    ? "bg-primary text-primary-foreground"
                    : isPast
                      ? "bg-muted text-muted-foreground"
                      : "bg-muted/50 text-muted-foreground"
                )}
              >
                {idx + 1}
              </span>
              <div className="min-w-0">
                <p
                  className={cn(
                    "text-xs leading-tight",
                    isActive ? "text-foreground font-medium" : "text-muted-foreground"
                  )}
                >
                  {step.label}
                </p>
                <p className="text-[10px] text-muted-foreground/70 mt-0.5">{step.time}</p>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

async function generateInterviewQuestions(
  type: InterviewType,
  resume: string,
  jobDescription: string,
  targetCompany: TargetCompany,
  config: SessionConfig,
  previousQuestions: string[] = [],
  questionFocusAreas = ""
): Promise<InterviewQuestion[]> {
  const { generateInterviewQuestions: generateQuestions } = await import("@/lib/interviewCoaching");
  
  return generateQuestions({
    type,
    resume: resume.trim(),
    jobDescription: jobDescription.trim(),
    projects: [],
    targetCompany,
    count: config.questionCount,
    difficultyFocus: config.difficultyFocus,
    previousQuestions,
    questionFocusAreas: questionFocusAreas.trim(),
  });
}

// Helper function to save interview session
function saveInterviewSession(session: InterviewCoachingSession) {
  try {
    const sessions = JSON.parse(
      localStorage.getItem("interview-coaching-sessions") || "[]"
    );
    const existingIndex = sessions.findIndex((s: InterviewCoachingSession) => s.id === session.id);
    
    if (existingIndex >= 0) {
      sessions[existingIndex] = session;
    } else {
      sessions.push(session);
    }
    
    localStorage.setItem("interview-coaching-sessions", JSON.stringify(sessions));
  } catch (err) {
    console.error("Failed to save interview session:", err);
  }
}

import { useEffect, useCallback, useState, useRef } from "react";
import { InterviewCoachingMode, CoachingFeedback } from "./InterviewCoachingMode";
import type { InterviewQuestion, TargetCompany } from "./InterviewCoachingMode";
import type { useSystemAudioType } from "@/hooks";
import { useApp } from "@/contexts";
import { useTTS } from "@/hooks/useTTS";
import { fetchSTT, fetchAIResponse } from "@/lib/functions";
import { shouldUseHostedAPI } from "@/lib/functions/hosted.api";
import {
  buildSuggestedAnswerInstructions,
  buildCoachingOutputFormatInstructions,
  parseCoachingFromResponse,
} from "@/lib/interviewCoaching";
import { floatArrayToWav } from "@/lib/utils";
import { useMicVAD } from "@ricky0123/vad-react";
import {
  DEFAULT_DEEPGRAM_TTS_MODEL,
  STORAGE_KEYS,
} from "@/config";
import { safeLocalStorage } from "@/lib/storage/helper";

interface InterviewCoachingWrapperProps {
  systemAudioProps?: useSystemAudioType;
  onClose: () => void;
}

function extractProviderApiKey(variables: Record<string, string>): string {
  return (
    variables.API_KEY ||
    variables.api_key ||
    variables.apiKey ||
    variables.token ||
    ""
  ).trim();
}

function resolveDeepgramApiKey(
  selectedSttProvider: {
    provider: string;
    variables: Record<string, string>;
  },
  allSttProviders: { id?: string }[]
): string {
  const stored = safeLocalStorage.getItem(STORAGE_KEYS.DEEPGRAM_TTS_API_KEY);
  if (stored?.trim()) return stored.trim();

  const fromSelected = extractProviderApiKey(selectedSttProvider.variables);
  if (fromSelected) return fromSelected;

  if (selectedSttProvider.provider === "deepgram-stt") {
    return fromSelected;
  }

  const hasDeepgram = allSttProviders.some((p) => p.id === "deepgram-stt");
  if (hasDeepgram && fromSelected) return fromSelected;

  return "";
}

function getInitialTtsApiKey(
  selectedSttProvider: {
    provider: string;
    variables: Record<string, string>;
  },
  allSttProviders: { id?: string }[]
): string {
  return resolveDeepgramApiKey(selectedSttProvider, allSttProviders);
}

export const InterviewCoachingWrapper = ({
  systemAudioProps,
  onClose,
}: InterviewCoachingWrapperProps) => {
  void systemAudioProps;

  const {
    selectedSttProvider,
    allSttProviders,
    selectedAIProvider,
    allAiProviders,
    selectedAudioDevices,
  } = useApp();

  const [ttsEnabled, setTtsEnabled] = useState(
    () => safeLocalStorage.getItem(STORAGE_KEYS.DEEPGRAM_TTS_ENABLED) !== "false"
  );
  const [ttsApiKey, setTtsApiKey] = useState(() =>
    getInitialTtsApiKey(selectedSttProvider, allSttProviders)
  );
  const [ttsModel, setTtsModel] = useState(
    () =>
      safeLocalStorage.getItem(STORAGE_KEYS.DEEPGRAM_TTS_MODEL) ||
      DEFAULT_DEEPGRAM_TTS_MODEL
  );

  const { speak, stop: stopTts, unlockAudio, isSpeaking, isLoading: isTtsLoading, error: ttsError } =
    useTTS({ apiKey: ttsApiKey, model: ttsModel, enabled: ttsEnabled });

  useEffect(() => {
    if (ttsApiKey.trim()) return;
    const resolved = resolveDeepgramApiKey(selectedSttProvider, allSttProviders);
    if (resolved) {
      setTtsApiKey(resolved);
      safeLocalStorage.setItem(STORAGE_KEYS.DEEPGRAM_TTS_API_KEY, resolved);
    }
  }, [selectedSttProvider, allSttProviders, ttsApiKey]);

  const handleTtsEnabledChange = useCallback((enabled: boolean) => {
    setTtsEnabled(enabled);
    safeLocalStorage.setItem(
      STORAGE_KEYS.DEEPGRAM_TTS_ENABLED,
      enabled ? "true" : "false"
    );
    if (!enabled) stopTts();
  }, [stopTts]);

  const handleTtsApiKeyChange = useCallback((key: string) => {
    setTtsApiKey(key);
    safeLocalStorage.setItem(STORAGE_KEYS.DEEPGRAM_TTS_API_KEY, key);
  }, []);

  const handleTtsModelChange = useCallback((model: string) => {
    setTtsModel(model);
    safeLocalStorage.setItem(STORAGE_KEYS.DEEPGRAM_TTS_MODEL, model);
  }, []);

  const [isListening, setIsListening] = useState(false);
  const [accumulatedTranscript, setAccumulatedTranscript] = useState("");
  const [, setIsTranscribing] = useState(false);

  const isListeningRef = useRef(false);
  const isTtsActiveRef = useRef(false);

  isListeningRef.current = isListening;
  isTtsActiveRef.current = isSpeaking || isTtsLoading;

  const currentQuestionRef = useRef<InterviewQuestion | null>(null);
  const interviewTypeRef = useRef<string>("general");
  const targetCompanyRef = useRef<TargetCompany>("generic");
  const resumeRef = useRef<string | undefined>(undefined);
  const jobDescriptionRef = useRef<string | undefined>(undefined);

  const audioConstraints: MediaTrackConstraints =
    selectedAudioDevices?.input?.id && selectedAudioDevices.input.id !== "default"
      ? { deviceId: { exact: selectedAudioDevices.input.id } }
      : {};

  const vad = useMicVAD({
    userSpeakingThreshold: 0.6,
    startOnLoad: false,
    additionalAudioConstraints: audioConstraints,
    onSpeechEnd: async (audio: Float32Array) => {
      if (!isListeningRef.current || isTtsActiveRef.current) return;

      try {
        setIsTranscribing(true);
        const audioBlob = floatArrayToWav(audio, 16000, "wav");

        const useHostedAPI = await shouldUseHostedAPI();
        const providerConfig = allSttProviders.find(
          (p) => p.id === selectedSttProvider.provider
        );

        if (!providerConfig && !useHostedAPI) {
          console.warn("[InterviewCoaching] No STT provider configured");
          return;
        }

        const transcription = await fetchSTT({
          provider: useHostedAPI ? undefined : providerConfig,
          selectedProvider: selectedSttProvider,
          audio: audioBlob,
        });

        if (transcription?.trim()) {
          setAccumulatedTranscript((prev) =>
            prev ? `${prev} ${transcription.trim()}` : transcription.trim()
          );
        }
      } catch (err) {
        console.error("[InterviewCoaching] STT error:", err);
      } finally {
        setIsTranscribing(false);
      }
    },
  });

  useEffect(() => {
    if (isListening && !isSpeaking && !isTtsLoading) {
      vad.start();
    } else {
      vad.pause();
    }
  }, [isListening, isSpeaking, isTtsLoading]);

  const handleStartListening = useCallback(async (_questionId: string) => {
    if (isSpeaking || isTtsLoading) return;
    setAccumulatedTranscript("");
    setIsListening(true);
  }, [isSpeaking, isTtsLoading]);

  const handleStopListening = useCallback(async () => {
    setIsListening(false);
  }, []);

  const handleSessionReset = useCallback(() => {
    setAccumulatedTranscript("");
    setIsListening(false);
  }, []);

  const handleSessionContext = useCallback(
    (question: InterviewQuestion, type: string, resume?: string, jd?: string, company?: TargetCompany) => {
      currentQuestionRef.current = question;
      interviewTypeRef.current = type;
      targetCompanyRef.current = company || "generic";
      resumeRef.current = resume;
      jobDescriptionRef.current = jd;
    },
    []
  );

  const handleSubmitAnswer = useCallback(
    async (_questionId: string, transcript: string): Promise<CoachingFeedback> => {
      stopTts();
      setIsListening(false);

      const finalTranscript = transcript || accumulatedTranscript;
      if (!finalTranscript.trim()) throw new Error("No answer provided");

      const question = currentQuestionRef.current;
      if (!question) throw new Error("No active question");

      const systemPrompt = buildEvalPrompt(
        question,
        finalTranscript,
        interviewTypeRef.current,
        resumeRef.current,
        jobDescriptionRef.current
      );

      const useHostedAPI = await shouldUseHostedAPI();
      const provider = allAiProviders.find(
        (p) => p.id === selectedAIProvider.provider
      );

      if (!provider && !useHostedAPI) {
        throw new Error("No AI provider configured. Please check your settings.");
      }

      let raw = "";
      for await (const chunk of fetchAIResponse({
        provider: useHostedAPI ? undefined : provider,
        selectedProvider: selectedAIProvider,
        systemPrompt,
        userMessage:
          "Evaluate this interview answer. Return JSON feedback with suggestedAnswer empty, then L4/L5/L6 model answers using ===FAANG_MODEL_ANSWER_L4===, ===FAANG_MODEL_ANSWER_L5===, and ===FAANG_MODEL_ANSWER_L6=== delimiters.",
        history: [],
        imagesBase64: [],
        systemPromptOnly: true,
      })) {
        raw += chunk;
      }

      return parseCoachingFromResponse(raw);
    },
    [accumulatedTranscript, allAiProviders, selectedAIProvider, stopTts]
  );

  const handleGenerateFollowUp = useCallback(
    async (question: InterviewQuestion, answer: string, feedback: CoachingFeedback): Promise<string> => {
      if (feedback.followUpQuestions && feedback.followUpQuestions.length > 0) {
        return feedback.followUpQuestions[0];
      }

      const useHostedAPI = await shouldUseHostedAPI();
      const provider = allAiProviders.find(
        (p) => p.id === selectedAIProvider.provider
      );
      if (!provider && !useHostedAPI) throw new Error("No AI provider configured.");

      const prompt = `You are a FAANG interviewer conducting a follow-up. The candidate just answered a question. Based on their answer and the coaching feedback, generate ONE probing follow-up question.

Original question: "${question.question}"
Candidate's answer: "${answer}"
Weaknesses identified: ${feedback.improvements.join("; ")}

Generate a single, specific follow-up question that probes the weakest part of their answer. Just return the question text, nothing else.`;

      let raw = "";
      for await (const chunk of fetchAIResponse({
        provider: useHostedAPI ? undefined : provider,
        selectedProvider: selectedAIProvider,
        systemPrompt: prompt,
        userMessage: "Generate a follow-up question.",
        history: [],
        imagesBase64: [],
        systemPromptOnly: true,
      })) {
        raw += chunk;
      }
      return raw.trim().replace(/^["']|["']$/g, "");
    },
    [allAiProviders, selectedAIProvider]
  );

  useEffect(() => {
    return () => stopTts();
  }, [stopTts]);

  return (
    <div className="relative h-full flex flex-col">
      <InterviewCoachingMode
        onClose={onClose}
        onStartListening={handleStartListening}
        onStopListening={handleStopListening}
        onSessionReset={handleSessionReset}
        onSessionContext={handleSessionContext}
        isListening={isListening}
        currentTranscript={accumulatedTranscript}
        onSubmitAnswer={handleSubmitAnswer}
        onGenerateFollowUp={handleGenerateFollowUp}
        ttsEnabled={ttsEnabled}
        onTtsEnabledChange={handleTtsEnabledChange}
        ttsApiKey={ttsApiKey}
        onTtsApiKeyChange={handleTtsApiKeyChange}
        ttsModel={ttsModel}
        onTtsModelChange={handleTtsModelChange}
        speak={speak}
        stopTts={stopTts}
        unlockAudio={unlockAudio}
        isTtsSpeaking={isSpeaking}
        isTtsLoading={isTtsLoading}
        ttsError={ttsError}
      />
    </div>
  );
};

function buildEvalPrompt(
  question: InterviewQuestion,
  answer: string,
  type: string,
  resume?: string,
  jobDescription?: string
): string {
  const contextParts: string[] = [];
  if (resume) contextParts.push(`**Candidate Background:** ${resume.slice(0, 500)}`);
  if (jobDescription) contextParts.push(`**Target Role:** ${jobDescription.slice(0, 500)}`);

  const lpContext = question.leadershipPrinciple
    ? `\n**Amazon Leadership Principle:** ${question.leadershipPrinciple}\nEvaluate how well the answer demonstrates this LP. Include a "companySpecificNotes" field about LP alignment.`
    : "";

  const companyJsonField = question.leadershipPrinciple
    ? `,\n  "companySpecificNotes": "How the answer aligns with the LP",\n  "followUpQuestions": ["A probing follow-up question"]`
    : `,\n  "followUpQuestions": ["A probing follow-up question based on their answer"]`;

  return `You are a senior FAANG interview coach. Provide specific, evidence-based feedback by quoting or referencing the candidate's actual words.

**Interview Question:**
${question.question}
${question.context ? `\nContext: ${question.context}` : ""}${lpContext}

**Candidate's Spoken Answer (transcript):**
"${answer}"

${contextParts.length > 0 ? contextParts.join("\n\n") + "\n\n" : ""}
**Expected Key Points:**
${question.expectedKeyPoints?.map((p, i) => `${i + 1}. ${p}`).join("\n") || "N/A"}

Evaluate based on FAANG ${type} interview standards. Be specific — reference EXACT phrases from the transcript when noting strengths or weaknesses.
${buildCoachingOutputFormatInstructions()}
${buildSuggestedAnswerInstructions(type)}

Example JSON (part 1 only — set suggestedAnswer to ""):
{
  "score": 75,
  "strengths": ["Quote/reference specific parts of their answer that were strong"],
  "improvements": ["Quote/reference specific weak parts and explain how to fix them"],
  "faangComparison": "2-3 sentences comparing this answer to what a FAANG hire would say.",
  "suggestedAnswer": "",
  "nextSteps": ["Specific practice action referencing their gaps", "Another actionable step"]${companyJsonField}
}

Be honest but constructive. Always reference the actual transcript.`;
}

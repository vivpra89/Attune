import { useState, useCallback, useEffect, useRef } from "react";
import {
  InterviewQuestion,
  CoachingFeedback,
  InterviewCoachingSession,
} from "@/pages/app/components/speech/InterviewCoachingMode";
import {
  generateInterviewQuestions,
  evaluateInterviewAnswer,
  GenerateQuestionsParams,
} from "@/lib/interviewCoaching";

export interface UseInterviewCoachingParams {
  onError?: (error: string) => void;
}

export interface UseInterviewCoachingReturn {
  // Session state
  isCoachingMode: boolean;
  currentSession: InterviewCoachingSession | null;
  
  // Question state
  currentQuestion: InterviewQuestion | null;
  currentQuestionIndex: number;
  totalQuestions: number;
  
  // Answer state  
  isListeningForAnswer: boolean;
  currentAnswer: string;
  
  // Feedback state
  currentFeedback: CoachingFeedback | null;
  isEvaluating: boolean;
  
  // Actions
  startCoachingSession: (params: GenerateQuestionsParams) => Promise<void>;
  startListening: () => void;
  stopListening: () => void;
  submitAnswer: (answer: string) => Promise<void>;
  moveToNextQuestion: () => void;
  endSession: () => void;
  
  // Loading states
  isGeneratingQuestions: boolean;
  error: string;
}

/**
 * Hook for managing interview coaching mode with speech integration
 */
export function useInterviewCoaching(
  params: UseInterviewCoachingParams = {}
): UseInterviewCoachingReturn {
  const { onError } = params;
  
  // Session state
  const [isCoachingMode, setIsCoachingMode] = useState(false);
  const [currentSession, setCurrentSession] = useState<InterviewCoachingSession | null>(null);
  const [currentQuestion, setCurrentQuestion] = useState<InterviewQuestion | null>(null);
  
  // Answer state
  const [isListeningForAnswer, setIsListeningForAnswer] = useState(false);
  const [currentAnswer, setCurrentAnswer] = useState("");
  
  // Feedback state
  const [currentFeedback, setCurrentFeedback] = useState<CoachingFeedback | null>(null);
  const [isEvaluating, setIsEvaluating] = useState(false);
  
  // Loading states
  const [isGeneratingQuestions, setIsGeneratingQuestions] = useState(false);
  const [error, setError] = useState("");
  
  // Refs for tracking
  const sessionRef = useRef<InterviewCoachingSession | null>(null);
  const answerStartTimeRef = useRef<number>(0);

  // Update ref when session changes
  useEffect(() => {
    sessionRef.current = currentSession;
  }, [currentSession]);

  /**
   * Start a new coaching session
   */
  const startCoachingSession = useCallback(
    async (params: GenerateQuestionsParams) => {
      setIsGeneratingQuestions(true);
      setError("");
      
      try {
        // Generate personalized questions
        const questions = await generateInterviewQuestions(params);
        
        if (questions.length === 0) {
          throw new Error("No questions were generated");
        }
        
        // Create new session
        const newSession: InterviewCoachingSession = {
          id: `session-${Date.now()}`,
          type: params.type,
          targetCompany: params.targetCompany || "generic",
          resume: params.resume,
          jobDescription: params.jobDescription,
          projects: params.projects,
          currentQuestionIndex: 0,
          questions,
          answers: [],
          followUpAnswers: [],
          overallScore: 0,
          config: {
            questionCount: params.count || 5,
            difficultyFocus: params.difficultyFocus || "mixed",
            enableFollowUps: true,
            enableCountdown: false,
          },
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        
        setCurrentSession(newSession);
        setCurrentQuestion(questions[0]);
        setIsCoachingMode(true);
        setCurrentFeedback(null);
        setCurrentAnswer("");
        
        // Save to localStorage
        saveSession(newSession);
        
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : "Failed to start coaching session";
        setError(errorMsg);
        if (onError) onError(errorMsg);
      } finally {
        setIsGeneratingQuestions(false);
      }
    },
    [onError]
  );

  /**
   * Start listening for answer
   */
  const startListening = useCallback(() => {
    if (!currentQuestion) return;
    
    setIsListeningForAnswer(true);
    setCurrentAnswer("");
    answerStartTimeRef.current = Date.now();
  }, [currentQuestion]);

  /**
   * Stop listening for answer
   */
  const stopListening = useCallback(() => {
    setIsListeningForAnswer(false);
  }, []);


  /**
   * Submit answer for evaluation
   */
  const submitAnswer = useCallback(
    async (answer: string) => {
      if (!currentQuestion || !currentSession) {
        setError("No active question or session");
        return;
      }
      
      if (!answer.trim()) {
        setError("Please provide an answer");
        return;
      }
      
      setIsEvaluating(true);
      setError("");
      
      try {
        // Evaluate the answer
        const feedback = await evaluateInterviewAnswer({
          question: currentQuestion,
          answer,
          interviewType: currentSession.type,
          resume: currentSession.resume,
          jobDescription: currentSession.jobDescription,
        });
        
        // Store the answer and feedback
        const newAnswer = {
          questionId: currentQuestion.id,
          transcriptText: answer,
          timestamp: Date.now(),
          coaching: feedback,
        };
        
        const updatedSession = {
          ...currentSession,
          answers: [...currentSession.answers, newAnswer],
          updatedAt: Date.now(),
        };
        
        setCurrentSession(updatedSession);
        setCurrentFeedback(feedback);
        setCurrentAnswer("");
        
        // Save updated session
        saveSession(updatedSession);
        
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : "Failed to evaluate answer";
        setError(errorMsg);
        if (onError) onError(errorMsg);
      } finally {
        setIsEvaluating(false);
      }
    },
    [currentQuestion, currentSession, onError]
  );

  /**
   * Move to the next question
   */
  const moveToNextQuestion = useCallback(() => {
    if (!currentSession) return;
    
    const nextIndex = currentSession.currentQuestionIndex + 1;
    
    if (nextIndex >= currentSession.questions.length) {
      // Session complete - calculate overall score
      const avgScore =
        currentSession.answers.reduce((sum, a) => sum + a.coaching.score, 0) /
        Math.max(currentSession.answers.length, 1);
      
      const completedSession = {
        ...currentSession,
        currentQuestionIndex: nextIndex,
        overallScore: Math.round(avgScore),
        updatedAt: Date.now(),
      };
      
      setCurrentSession(completedSession);
      setCurrentQuestion(null);
      setCurrentFeedback(null);
      
      // Save completed session
      saveSession(completedSession);
    } else {
      // Move to next question
      const updatedSession = {
        ...currentSession,
        currentQuestionIndex: nextIndex,
        updatedAt: Date.now(),
      };
      
      setCurrentSession(updatedSession);
      setCurrentQuestion(currentSession.questions[nextIndex]);
      setCurrentFeedback(null);
      setCurrentAnswer("");
      
      // Save progress
      saveSession(updatedSession);
    }
  }, [currentSession]);

  /**
   * End the coaching session
   */
  const endSession = useCallback(() => {
    setIsCoachingMode(false);
    setCurrentSession(null);
    setCurrentQuestion(null);
    setCurrentFeedback(null);
    setCurrentAnswer("");
    setIsListeningForAnswer(false);
    setError("");
  }, []);

  // Computed values
  const currentQuestionIndex = currentSession?.currentQuestionIndex ?? 0;
  const totalQuestions = currentSession?.questions.length ?? 0;

  return {
    // Session state
    isCoachingMode,
    currentSession,
    
    // Question state
    currentQuestion,
    currentQuestionIndex,
    totalQuestions,
    
    // Answer state
    isListeningForAnswer,
    currentAnswer,
    
    // Feedback state
    currentFeedback,
    isEvaluating,
    
    // Actions
    startCoachingSession,
    startListening,
    stopListening,
    submitAnswer,
    moveToNextQuestion,
    endSession,
    
    // Loading states
    isGeneratingQuestions,
    error,
  };
}

/**
 * Save interview session to localStorage
 */
function saveSession(session: InterviewCoachingSession) {
  try {
    const key = "interview-coaching-sessions";
    const stored = localStorage.getItem(key);
    const sessions: InterviewCoachingSession[] = stored ? JSON.parse(stored) : [];
    
    const existingIndex = sessions.findIndex((s) => s.id === session.id);
    
    if (existingIndex >= 0) {
      sessions[existingIndex] = session;
    } else {
      sessions.push(session);
    }
    
    // Keep only last 20 sessions
    const recentSessions = sessions
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 20);
    
    localStorage.setItem(key, JSON.stringify(recentSessions));
  } catch (err) {
    console.error("Failed to save interview session:", err);
  }
}

/**
 * Load recent interview sessions from localStorage
 */
export function loadRecentSessions(): InterviewCoachingSession[] {
  try {
    const key = "interview-coaching-sessions";
    const stored = localStorage.getItem(key);
    
    if (!stored) return [];
    
    const sessions: InterviewCoachingSession[] = JSON.parse(stored);
    return sessions.sort((a, b) => b.updatedAt - a.updatedAt);
  } catch (err) {
    console.error("Failed to load interview sessions:", err);
    return [];
  }
}

/**
 * Delete an interview session
 */
export function deleteSession(sessionId: string) {
  try {
    const key = "interview-coaching-sessions";
    const stored = localStorage.getItem(key);
    
    if (!stored) return;
    
    const sessions: InterviewCoachingSession[] = JSON.parse(stored);
    const filtered = sessions.filter((s) => s.id !== sessionId);
    
    localStorage.setItem(key, JSON.stringify(filtered));
  } catch (err) {
    console.error("Failed to delete interview session:", err);
  }
}

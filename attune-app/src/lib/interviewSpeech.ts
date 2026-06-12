import type { CoachingFeedback, InterviewQuestion, InterviewType } from "@/pages/app/components/speech/InterviewCoachingMode";

export function formatInterviewType(type: InterviewType): string {
  return type.replace(/_/g, " ");
}

export function buildOpeningSpeech(
  type: InterviewType,
  questionCount: number,
  question: InterviewQuestion
): string {
  return (
    `Hi, thanks for joining today. We'll run a ${formatInterviewType(type)} mock interview with ${questionCount} questions. ` +
    `Take your time on each answer. Here's your first question: ${getQuestionSpeechText(question)}`
  );
}

export function buildNextQuestionSpeech(
  questionIndex: number,
  total: number,
  question: InterviewQuestion
): string {
  return (
    `Great, let's move on. Question ${questionIndex + 1} of ${total}. ` +
    getQuestionSpeechText(question)
  );
}

export function buildFollowUpSpeech(followUpQuestion: string): string {
  return `I'd like to dig deeper on that. ${followUpQuestion}`;
}

export function buildFeedbackSpeech(feedback: CoachingFeedback): string {
  const parts: string[] = [
    `Thanks for that answer. I'd score it ${feedback.score} out of 100.`,
  ];

  if (feedback.faangComparison) {
    parts.push(feedback.faangComparison);
  }
  if (feedback.strengths[0]) {
    parts.push(`What worked well: ${feedback.strengths[0]}`);
  }
  if (feedback.improvements[0]) {
    parts.push(`One thing to sharpen: ${feedback.improvements[0]}`);
  }

  parts.push("Review the detailed feedback on screen, then continue when you're ready.");
  return parts.join(" ");
}

export function buildCompleteSpeech(overallScore: number, questionCount: number): string {
  return (
    `That wraps up our session. You answered ${questionCount} questions with an overall score of ${Math.round(overallScore)} out of 100. ` +
    `Nice work today — review your feedback and keep practicing.`
  );
}

export function getQuestionSpeechText(question: InterviewQuestion): string {
  let text = question.question;
  if (question.context) {
    text += `. ${question.context}`;
  }
  return text;
}

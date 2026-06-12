import { useApp } from "@/contexts";
import { PageLayout } from "@/layouts";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
  Label,
  Switch,
  Textarea,
  Button,
} from "@/components";
import {
  FileTextIcon,
  FolderOpenIcon,
  BriefcaseIcon,
  Trash2Icon,
  SparklesIcon,
  LoaderIcon,
  ChevronDownIcon,
} from "lucide-react";
import { useState, useCallback, useRef, useEffect } from "react";
import { fetchAIResponse } from "@/lib/functions";
import { shouldUseHostedAPI } from "@/lib/functions/hosted.api";
import { PROJECTS_SUMMARY_THRESHOLD } from "@/lib/storage/interview-context.storage";

const SECTION_CONFIG = [
  {
    key: "resume" as const,
    label: "Resume / CV",
    icon: FileTextIcon,
    placeholder:
      "Paste your resume content here...\n\nExample:\nJohn Doe — Senior Software Engineer\n\nExperience:\n• 5 years at TechCorp building distributed systems\n• Led migration from monolith to microservices\n\nSkills: TypeScript, React, Rust, AWS, Kubernetes\n\nEducation: B.S. Computer Science, MIT",
    description:
      "Your background, skills, experience, and education. This helps the AI craft personalized answers that highlight your strengths.",
  },
  {
    key: "projects" as const,
    label: "Projects & Portfolio",
    icon: FolderOpenIcon,
    placeholder:
      "Describe your key projects here...\n\nExample:\n1. Real-time Chat Platform — Built with WebSockets, Redis pub/sub, serving 10K concurrent users\n2. ML Pipeline — Automated data preprocessing and model training, reduced deployment time by 60%\n3. Open Source CLI Tool — 2K+ GitHub stars, Rust-based file search utility",
    description:
      "Details about your notable projects, contributions, and achievements. The AI can reference these when answering behavioral or technical questions.",
  },
  {
    key: "jobDescription" as const,
    label: "Job Description",
    icon: BriefcaseIcon,
    placeholder:
      "Paste the job description you're interviewing for...\n\nExample:\nSenior Full-Stack Engineer at Acme Inc.\n\nResponsibilities:\n• Design and build scalable web applications\n• Mentor junior engineers\n\nRequirements:\n• 5+ years experience with React and Node.js\n• Experience with cloud infrastructure (AWS/GCP)",
    description:
      "The job posting you're targeting. This helps the AI tailor answers to match what the interviewer is looking for.",
  },
];

const SUMMARIZE_SYSTEM_PROMPT =
  "You are a concise summarizer. For each distinct project in the text below, output a short summary with: project name, tech stack, 1-2 key outcomes or metrics. Use bullet points. Keep each project to 2-3 lines max. Do not add commentary or introductions—just the summaries.";

const InterviewContextPage = () => {
  const {
    interviewContext,
    setInterviewContext,
    selectedAIProvider,
    allAiProviders,
  } = useApp();
  const [expandedSection, setExpandedSection] = useState<string | null>(null);
  const [isSummarizing, setIsSummarizing] = useState(false);
  const [summarizeError, setSummarizeError] = useState<string | null>(null);
  const [showSummaryPreview, setShowSummaryPreview] = useState(false);
  const summarizeAbortRef = useRef<AbortController | null>(null);

  const needsSummary =
    interviewContext.projects.trim().length > PROJECTS_SUMMARY_THRESHOLD;

  const hasSummary = interviewContext.projectsSummary.trim().length > 0;

  const handleFieldChange = useCallback(
    (field: "resume" | "projects" | "jobDescription", value: string) => {
      const update: Record<string, string> = { [field]: value };
      if (field === "projects") {
        update.projectsSummary = "";
      }
      setInterviewContext({ ...interviewContext, ...update });
    },
    [interviewContext, setInterviewContext]
  );

  const handleToggle = useCallback(
    (enabled: boolean) => {
      setInterviewContext({ ...interviewContext, enabled });
    },
    [interviewContext, setInterviewContext]
  );

  const handleClearField = useCallback(
    (field: "resume" | "projects" | "jobDescription") => {
      const update: Record<string, string> = { [field]: "" };
      if (field === "projects") {
        update.projectsSummary = "";
      }
      setInterviewContext({ ...interviewContext, ...update });
    },
    [interviewContext, setInterviewContext]
  );

  const handleClearAll = useCallback(() => {
    setInterviewContext({
      resume: "",
      projects: "",
      projectsSummary: "",
      jobDescription: "",
      enabled: interviewContext.enabled,
    });
  }, [interviewContext.enabled, setInterviewContext]);

  const summarizeProjects = useCallback(async () => {
    if (!interviewContext.projects.trim()) return;

    if (summarizeAbortRef.current) {
      summarizeAbortRef.current.abort();
    }
    summarizeAbortRef.current = new AbortController();

    setIsSummarizing(true);
    setSummarizeError(null);

    try {
      const useHosted = await shouldUseHostedAPI();
      const provider = allAiProviders.find(
        (p) => p.id === selectedAIProvider.provider
      );

      if (!provider && !useHosted) {
        setSummarizeError("No AI provider configured. Set one in Settings.");
        setIsSummarizing(false);
        return;
      }

      let fullResponse = "";
      for await (const chunk of fetchAIResponse({
        provider: useHosted ? undefined : provider,
        selectedProvider: selectedAIProvider,
        systemPrompt: SUMMARIZE_SYSTEM_PROMPT,
        userMessage: interviewContext.projects,
        history: [],
        imagesBase64: [],
        signal: summarizeAbortRef.current.signal,
      })) {
        fullResponse += chunk;
      }

      if (fullResponse.trim()) {
        setInterviewContext({
          ...interviewContext,
          projectsSummary: fullResponse.trim(),
        });
        setShowSummaryPreview(true);
      } else {
        setSummarizeError("AI returned an empty summary. Try again.");
      }
    } catch (err: any) {
      if (err?.name !== "AbortError") {
        setSummarizeError(err?.message || "Failed to summarize projects.");
      }
    } finally {
      setIsSummarizing(false);
    }
  }, [
    interviewContext,
    setInterviewContext,
    selectedAIProvider,
    allAiProviders,
  ]);

  // Auto-summarize when projects text goes over threshold and no summary exists
  const prevProjectsRef = useRef(interviewContext.projects);
  useEffect(() => {
    const changed = prevProjectsRef.current !== interviewContext.projects;
    prevProjectsRef.current = interviewContext.projects;
    if (!changed) return;

    if (
      interviewContext.projects.trim().length > PROJECTS_SUMMARY_THRESHOLD &&
      !interviewContext.projectsSummary.trim() &&
      interviewContext.enabled &&
      !isSummarizing
    ) {
      const timer = setTimeout(() => {
        summarizeProjects();
      }, 1500);
      return () => clearTimeout(timer);
    }
  }, [
    interviewContext.projects,
    interviewContext.projectsSummary,
    interviewContext.enabled,
    isSummarizing,
    summarizeProjects,
  ]);

  // Cleanup abort on unmount
  useEffect(() => {
    return () => {
      if (summarizeAbortRef.current) {
        summarizeAbortRef.current.abort();
      }
    };
  }, []);

  const filledCount = SECTION_CONFIG.filter(
    (s) => interviewContext[s.key].trim().length > 0
  ).length;

  return (
    <PageLayout
      title="Interview Context"
      description="Resume, projects, and job description for prompts. Interview answer style (LeetCode, ML, behavioral, etc.) is on the Dashboard."
      rightSlot={
        <div className="flex items-center gap-3">
          <Label
            htmlFor="interview-context-toggle"
            className="text-xs text-muted-foreground"
          >
            {interviewContext.enabled ? "Active" : "Disabled"}
          </Label>
          <Switch
            id="interview-context-toggle"
            checked={interviewContext.enabled}
            onCheckedChange={handleToggle}
          />
        </div>
      }
    >
      {/* Status bar */}
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          {filledCount} of {SECTION_CONFIG.length} sections filled
          {!interviewContext.enabled && " (context is disabled)"}
        </p>
        {filledCount > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="text-xs text-destructive hover:text-destructive"
            onClick={handleClearAll}
          >
            <Trash2Icon className="size-3 mr-1" />
            Clear all
          </Button>
        )}
      </div>

      {/* Info box */}
      <div className="text-xs text-blue-600 dark:text-blue-400 bg-blue-500/10 p-3 rounded-md space-y-1">
        <p>
          <strong>How it works:</strong> When enabled, your interview context is
          automatically included in every AI prompt — both for text completions
          and system audio transcription. The AI will use your background to
          provide relevant, personalized answers. Replies are phrased in{" "}
          <strong>first person</strong> (as if you are speaking), not as "your
          work" or "the candidate."
        </p>
        <p className="text-blue-600/80 dark:text-blue-400/80">
          Projects longer than {PROJECTS_SUMMARY_THRESHOLD.toLocaleString()}{" "}
          characters are <strong>auto-summarized</strong> to keep prompts fast
          and focused. Your full text is preserved — only the summary is sent to
          the AI.
        </p>
        <p className="text-blue-600/80 dark:text-blue-400/80">
          Your data is stored locally and never sent anywhere except to your
          configured AI provider as part of the prompt.
        </p>
      </div>

      {/* Context sections */}
      <div className="flex flex-col gap-4">
        {SECTION_CONFIG.map((section) => {
          const value = interviewContext[section.key];
          const hasContent = value.trim().length > 0;
          const isExpanded = expandedSection === section.key;
          const charCount = value.length;
          const isProjects = section.key === "projects";

          return (
            <Card
              key={section.key}
              className={`border shadow-none transition-all ${
                hasContent
                  ? "border-primary/30 bg-primary/5 dark:bg-primary/5"
                  : "bg-black/5 dark:bg-white/5 border-transparent"
              } ${!interviewContext.enabled ? "opacity-60" : ""}`}
            >
              <CardHeader
                className="cursor-pointer select-none p-4 pb-2"
                onClick={() =>
                  setExpandedSection(isExpanded ? null : section.key)
                }
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div
                      className={`flex size-8 items-center justify-center rounded-lg ${
                        hasContent
                          ? "bg-primary/10 text-primary"
                          : "bg-muted text-muted-foreground"
                      }`}
                    >
                      <section.icon className="size-4" />
                    </div>
                    <div>
                      <CardTitle className="text-sm flex items-center gap-2">
                        {section.label}
                        {isProjects && isSummarizing && (
                          <span className="flex items-center gap-1 text-[10px] text-amber-600 font-normal">
                            <LoaderIcon className="size-3 animate-spin" />
                            Summarizing…
                          </span>
                        )}
                        {isProjects && hasSummary && !isSummarizing && (
                          <span className="text-[10px] text-green-600 font-normal">
                            Summary ready
                          </span>
                        )}
                      </CardTitle>
                      <CardDescription className="text-xs">
                        {section.description}
                      </CardDescription>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {hasContent && (
                      <span className="text-[10px] text-muted-foreground">
                        {charCount.toLocaleString()} chars
                        {isProjects && needsSummary && (
                          <span className="text-amber-600">
                            {" "}
                            (over {PROJECTS_SUMMARY_THRESHOLD.toLocaleString()})
                          </span>
                        )}
                      </span>
                    )}
                    <ChevronDownIcon
                      className={`size-4 text-muted-foreground transition-transform ${
                        isExpanded ? "rotate-180" : ""
                      }`}
                    />
                  </div>
                </div>
              </CardHeader>

              {isExpanded && (
                <div className="px-4 pb-4 pt-2 space-y-2">
                  <Textarea
                    value={value}
                    onChange={(e) =>
                      handleFieldChange(section.key, e.target.value)
                    }
                    placeholder={section.placeholder}
                    className="min-h-[200px] text-sm resize-y"
                    disabled={!interviewContext.enabled}
                  />
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-muted-foreground">
                      {charCount.toLocaleString()} characters
                    </span>
                    <div className="flex items-center gap-2">
                      {isProjects && hasContent && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-xs h-6"
                          onClick={(e) => {
                            e.stopPropagation();
                            summarizeProjects();
                          }}
                          disabled={
                            !interviewContext.enabled || isSummarizing
                          }
                        >
                          {isSummarizing ? (
                            <LoaderIcon className="size-3 mr-1 animate-spin" />
                          ) : (
                            <SparklesIcon className="size-3 mr-1" />
                          )}
                          {hasSummary ? "Re-summarize" : "Summarize"}
                        </Button>
                      )}
                      {hasContent && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-xs text-destructive hover:text-destructive h-6"
                          onClick={() => handleClearField(section.key)}
                          disabled={!interviewContext.enabled}
                        >
                          <Trash2Icon className="size-3 mr-1" />
                          Clear
                        </Button>
                      )}
                    </div>
                  </div>

                  {/* Summary preview (projects only) */}
                  {isProjects && hasSummary && (
                    <div className="mt-2 rounded-lg border border-green-500/20 bg-green-500/5 p-3 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium text-green-700 dark:text-green-400">
                          Summary used in prompts (
                          {interviewContext.projectsSummary.length.toLocaleString()}{" "}
                          chars)
                        </span>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-[10px] h-5"
                          onClick={() =>
                            setShowSummaryPreview(!showSummaryPreview)
                          }
                        >
                          {showSummaryPreview ? "Hide" : "Show"}
                        </Button>
                      </div>
                      {showSummaryPreview && (
                        <p className="text-xs text-muted-foreground whitespace-pre-wrap leading-relaxed">
                          {interviewContext.projectsSummary}
                        </p>
                      )}
                    </div>
                  )}

                  {/* Summarize error */}
                  {isProjects && summarizeError && (
                    <div className="mt-1 rounded-md border border-destructive/20 bg-destructive/5 px-3 py-2">
                      <p className="text-xs text-destructive">
                        {summarizeError}
                      </p>
                    </div>
                  )}
                </div>
              )}
            </Card>
          );
        })}
      </div>
    </PageLayout>
  );
};

export default InterviewContextPage;

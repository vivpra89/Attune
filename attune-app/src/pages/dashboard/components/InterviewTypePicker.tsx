import { useCallback, useState } from "react";
import {
  CheckCircle2Icon,
  PencilIcon,
  RotateCcwIcon,
  ChevronDownIcon,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Button,
  Textarea,
} from "@/components";
import { useApp } from "@/contexts";
import { INTERVIEW_TYPES } from "@/lib/storage/interview-context.storage";
import type { InterviewType } from "@/types";

export function InterviewTypePicker() {
  const {
    interviewAnswerType,
    setInterviewAnswerType,
    interviewCustomPrompts,
    setInterviewCustomPrompt,
    resetInterviewCustomPrompt,
  } = useApp();

  const [editingType, setEditingType] = useState<InterviewType | null>(null);

  const onSelect = useCallback(
    (type: InterviewType) => {
      setInterviewAnswerType(type);
    },
    [setInterviewAnswerType]
  );

  const toggleEdit = useCallback(
    (type: InterviewType, e: React.MouseEvent) => {
      e.stopPropagation();
      setEditingType((prev) => (prev === type ? null : type));
    },
    []
  );

  return (
    <Card className="shadow-none border border-border/70 rounded-xl">
      <CardHeader className="pb-2">
        <CardTitle className="text-md lg:text-lg">Interview type</CardTitle>
        <CardDescription className="text-xs lg:text-sm">
          Choose how the AI should shape answers (coding, ML concepts,
          behavioral, etc.). Click the pencil icon to customize the prompt.
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-0 space-y-3">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
          {INTERVIEW_TYPES.map((type) => {
            const isSelected = interviewAnswerType === type.id;
            const isEditing = editingType === type.id;
            const hasCustomPrompt = interviewCustomPrompts[type.id] !== undefined;
            const showEditIcon = type.id !== "general";

            return (
              <button
                key={type.id}
                type="button"
                onClick={() => onSelect(type.id)}
                className={`group relative flex flex-col items-start gap-1 rounded-xl border-2 p-3 text-left transition-all hover:shadow-sm ${
                  isSelected
                    ? "border-primary bg-primary/5 dark:bg-primary/10"
                    : "border-transparent bg-black/5 dark:bg-white/5 hover:border-muted-foreground/20"
                } ${isEditing ? "ring-1 ring-primary/30" : ""}`}
              >
                <div className="absolute top-2 right-2 flex items-center gap-1">
                  {hasCustomPrompt && (
                    <span className="size-1.5 rounded-full bg-amber-500" title="Custom prompt" />
                  )}
                  {showEditIcon && (
                    <span
                      role="button"
                      onClick={(e) => toggleEdit(type.id, e)}
                      className={`p-0.5 rounded transition-opacity ${
                        isEditing
                          ? "opacity-100 text-primary"
                          : "opacity-0 group-hover:opacity-70 text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {isEditing ? (
                        <ChevronDownIcon className="size-3" />
                      ) : (
                        <PencilIcon className="size-3" />
                      )}
                    </span>
                  )}
                  {isSelected && (
                    <CheckCircle2Icon className="size-4 text-green-500 shrink-0" />
                  )}
                </div>
                <span className="text-xs font-medium pr-8">{type.label}</span>
                <span className="text-[10px] text-muted-foreground leading-snug">
                  {type.description}
                </span>
              </button>
            );
          })}
        </div>

        {editingType && editingType !== "general" && (
          <PromptEditor
            typeId={editingType}
            customPrompts={interviewCustomPrompts}
            onSave={setInterviewCustomPrompt}
            onReset={resetInterviewCustomPrompt}
          />
        )}
      </CardContent>
    </Card>
  );
}

function PromptEditor({
  typeId,
  customPrompts,
  onSave,
  onReset,
}: {
  typeId: InterviewType;
  customPrompts: Record<string, string | undefined>;
  onSave: (type: InterviewType, prompt: string) => void;
  onReset: (type: InterviewType) => void;
}) {
  const typeOption = INTERVIEW_TYPES.find((t) => t.id === typeId)!;
  const defaultPrompt = typeOption.prompt;
  const currentPrompt = customPrompts[typeId] ?? defaultPrompt;
  const isCustomized = customPrompts[typeId] !== undefined;

  return (
    <div className="rounded-lg border bg-muted/30 p-3 space-y-2 animate-in fade-in-0 slide-in-from-top-1 duration-200">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium">
          Prompt for{" "}
          <span className="text-primary">{typeOption.label}</span>
          {isCustomized && (
            <span className="ml-1.5 text-[10px] text-amber-600 dark:text-amber-400 font-normal">
              (customized)
            </span>
          )}
        </span>
        {isCustomized && (
          <Button
            variant="ghost"
            size="sm"
            className="text-[10px] h-6 text-muted-foreground"
            onClick={() => onReset(typeId)}
          >
            <RotateCcwIcon className="size-3 mr-1" />
            Reset to default
          </Button>
        )}
      </div>
      <Textarea
        value={currentPrompt}
        onChange={(e) => onSave(typeId, e.target.value)}
        className="min-h-[140px] text-xs font-mono resize-y"
        placeholder="Enter custom prompt instructions for this interview type..."
      />
      <p className="text-[10px] text-muted-foreground">
        This prompt is appended to every AI request when this interview type is selected.
      </p>
    </div>
  );
}

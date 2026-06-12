import { Button } from "@/components";
import { TrophyIcon } from "lucide-react";
import type { useSystemAudioType } from "@/hooks";
import { cn } from "@/lib/utils";
import { invoke } from "@tauri-apps/api/core";

interface InterviewCoachingButtonProps {
  systemAudioProps?: useSystemAudioType;
  className?: string;
}

export const InterviewCoachingButton = ({
  className,
}: InterviewCoachingButtonProps) => {
  const handleOpen = async () => {
    try {
      await invoke("open_interview_coaching");
    } catch (e) {
      console.error("Failed to open interview coaching window:", e);
    }
  };

  return (
    <Button
      onClick={handleOpen}
      variant="outline"
      size="icon"
      className={cn(className)}
      title="Interview Coach"
    >
      <TrophyIcon className="h-4 w-4" />
    </Button>
  );
};

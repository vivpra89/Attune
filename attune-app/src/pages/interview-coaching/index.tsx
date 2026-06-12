import { getCurrentWindow } from "@tauri-apps/api/window";
import { InterviewCoachingWrapper } from "@/pages/app/components/speech/InterviewCoachingWrapper";

const InterviewCoaching = () => {
  const handleClose = async () => {
    try {
      const win = getCurrentWindow();
      await win.hide();
    } catch (e) {
      console.error("Failed to close coaching window:", e);
    }
  };

  return (
    <div className="flex flex-col h-screen w-screen bg-background overflow-hidden">
      <InterviewCoachingWrapper onClose={handleClose} />
    </div>
  );
};

export default InterviewCoaching;

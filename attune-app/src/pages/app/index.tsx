import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useAttune } from "@/contexts/attune.context";
import { invoke } from "@tauri-apps/api/core";

const STATE_LABELS: Record<string, string> = {
  focused: "Here",
  soft_nudge: "Refocus",
  dimmed: "Pause",
  break_suggest: "Break?",
  confusion_help: "Stuck?",
};

const App = () => {
  const {
    activeSessionId,
    childMessage,
    feedbackState,
    startSession,
    stopSession,
  } = useAttune();

  const openDashboard = () => {
    invoke("open_parent_dashboard").catch(console.error);
  };

  const statusLabel = activeSessionId
    ? STATE_LABELS[feedbackState] ?? childMessage
    : "Ready";

  return (
    <div className="w-screen h-screen flex overflow-hidden justify-center items-start p-2">
      <Card className="flex flex-row items-center gap-3 px-3 py-2 bg-card/90 backdrop-blur-sm border border-border/60 shadow-lg">
        <div className="flex items-center gap-2">
          <img
            src="/attune-logo.png"
            alt="Attune"
            className={`size-8 rounded-lg object-cover ring-2 ${
              feedbackState === "focused"
                ? "ring-emerald-500/70"
                : feedbackState === "confusion_help"
                  ? "ring-sky-400/70"
                  : "ring-amber-400/70"
            }`}
          />
          <div className="text-xs max-w-[120px]">
            <p className="font-medium truncate">{statusLabel}</p>
            {activeSessionId && (
              <p className="text-muted-foreground truncate">{childMessage}</p>
            )}
          </div>
        </div>

        {activeSessionId ? (
          <Button size="sm" variant="outline" onClick={() => stopSession()}>
            Stop
          </Button>
        ) : (
          <Button size="sm" onClick={() => startSession()}>
            Start
          </Button>
        )}

        <Button size="sm" variant="ghost" onClick={openDashboard}>
          Dashboard
        </Button>
      </Card>
    </div>
  );
};

export default App;

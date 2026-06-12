import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Navigate, useNavigate } from "react-router-dom";
import { useAttune } from "@/contexts/attune.context";
import { Button } from "@/components/ui/button";
import { Camera, Shield, CheckCircle2, AlertCircle } from "lucide-react";

export function ParentSetup() {
  const { isUnlocked } = useAttune();
  const navigate = useNavigate();
  const [cameraStatus, setCameraStatus] = useState<number | null>(null);
  const [requesting, setRequesting] = useState(false);

  useEffect(() => {
    invoke<number>("check_camera_permission").then(setCameraStatus).catch(console.error);
  }, []);

  if (!isUnlocked) return <Navigate to="/parent" replace />;

  const requestCamera = async () => {
    setRequesting(true);
    try {
      const status = await invoke<number>("request_camera_permission");
      setCameraStatus(status);
    } finally {
      setRequesting(false);
    }
  };

  const cameraOk = cameraStatus === 2;

  return (
    <div className="space-y-8 max-w-lg">
      <div>
        <h1 className="text-2xl font-semibold">Setup & Permissions</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Attune needs a few one-time permissions. Raw video never leaves your device.
        </p>
      </div>

      <div className="rounded-xl border border-border p-5 space-y-4">
        <div className="flex items-start gap-3">
          <Camera className="size-5 text-amber-500 mt-0.5" />
          <div className="flex-1">
            <p className="font-medium">Camera</p>
            <p className="text-sm text-muted-foreground">
              Detects face presence and gaze on-device using Apple Vision. Required for
              attention scoring.
            </p>
            <div className="flex items-center gap-2 mt-3">
              {cameraOk ? (
                <CheckCircle2 className="size-4 text-green-500" />
              ) : (
                <AlertCircle className="size-4 text-amber-500" />
              )}
              <span className="text-sm">
                {cameraOk ? "Granted" : cameraStatus === 1 ? "Denied" : "Not granted"}
              </span>
            </div>
            {!cameraOk && (
              <Button
                size="sm"
                className="mt-3"
                onClick={requestCamera}
                disabled={requesting}
              >
                {requesting ? "Requesting..." : "Grant Camera Access"}
              </Button>
            )}
          </div>
        </div>

        <div className="flex items-start gap-3 border-t border-border pt-4">
          <Shield className="size-5 text-amber-500 mt-0.5" />
          <div className="flex-1">
            <p className="font-medium">Accessibility (optional)</p>
            <p className="text-sm text-muted-foreground">
              Lets Attune record which app your child is using (e.g. &quot;during
              ABCmouse&quot;). Enable in System Settings → Privacy → Accessibility if
              prompted.
            </p>
          </div>
        </div>
      </div>

      <div className="rounded-xl bg-muted/50 p-4 text-sm text-muted-foreground leading-relaxed">
        <strong className="text-foreground">Privacy promise:</strong> Attune stores only
        attention scores and app names — never video, audio, or screenshots. Session
        summaries are generated from numbers only.
      </div>

      <Button onClick={() => navigate("/parent/today")}>
        {cameraOk ? "Continue to Dashboard" : "Continue anyway"}
      </Button>
    </div>
  );
}

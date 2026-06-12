import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Navigate } from "react-router-dom";
import { useAttune } from "@/contexts/attune.context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";

const COMMON_FOCUS_APPS = [
  { label: "Khan Academy", bundle: "org.khanacademy.Khan-Academy" },
  { label: "Google Chrome", bundle: "com.google.Chrome" },
  { label: "Safari", bundle: "com.apple.Safari" },
  { label: "Notion", bundle: "notion.id" },
  { label: "Pages", bundle: "com.apple.iWork.Pages" },
];

interface LlmSettingsStatus {
  provider: string;
  provider_label: string;
  claude_configured: boolean;
  openai_configured: boolean;
}

interface InferenceStatus {
  model_version: string;
  engagement_loaded: boolean;
  affect_loaded: boolean;
  gaze_loaded: boolean;
  affect_source: string;
}

export function ParentSettings() {
  const { isUnlocked } = useAttune();
  const [apiKey, setApiKey] = useState("");
  const [openAiApiKey, setOpenAiApiKey] = useState("");
  const [llmProvider, setLlmProvider] = useState<"claude" | "openai">("claude");
  const [llmStatus, setLlmStatus] = useState<LlmSettingsStatus | null>(null);
  const [childName, setChildName] = useState("Child");
  const [sensitivity, setSensitivity] = useState(70);
  const [feedbackProfile, setFeedbackProfile] = useState("gentle");
  const [focusApps, setFocusApps] = useState<string[]>([]);
  const [customBundle, setCustomBundle] = useState("");
  const [improveAttune, setImproveAttune] = useState(false);
  const [debugMode, setDebugMode] = useState(false);
  const [audioCues, setAudioCues] = useState(true);
  const [inferenceStatus, setInferenceStatus] = useState<InferenceStatus | null>(null);
  const [trainingDailyMinutes, setTrainingDailyMinutes] = useState(25);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    invoke<string | null>("get_setting", { key: "child_name" }).then((v) => {
      if (v) setChildName(v);
    });
    invoke<string | null>("get_setting", { key: "dim_sensitivity" }).then((v) => {
      if (v) setSensitivity(parseInt(v, 10) || 70);
    });
    invoke<string | null>("get_setting", { key: "feedback_profile" }).then((v) => {
      if (v) setFeedbackProfile(v);
    });
    invoke<string | null>("get_setting", { key: "focus_apps" }).then((v) => {
      if (v) {
        try {
          setFocusApps(JSON.parse(v));
        } catch {
          setFocusApps([]);
        }
      }
    });
    invoke<string | null>("get_setting", { key: "improve_attune" }).then((v) => {
      setImproveAttune(v === "true");
    });
    invoke<string | null>("get_setting", { key: "debug_mode" }).then((v) => {
      setDebugMode(v === "true");
    });
    invoke<string | null>("get_setting", { key: "audio_cues" }).then((v) => {
      setAudioCues(v !== "false");
    });
    invoke<string | null>("get_setting", { key: "training_daily_minutes" }).then((v) => {
      if (v) setTrainingDailyMinutes(parseInt(v, 10) || 25);
    });
    invoke<string | null>("get_setting", { key: "llm_provider" }).then((v) => {
      if (v === "openai" || v === "claude") setLlmProvider(v);
    });
    invoke<LlmSettingsStatus>("get_llm_settings")
      .then((status) => {
        setLlmStatus(status);
        if (status.provider === "openai" || status.provider === "claude") {
          setLlmProvider(status.provider);
        }
      })
      .catch(() => setLlmStatus(null));
    invoke<InferenceStatus>("get_inference_status")
      .then(setInferenceStatus)
      .catch(() => setInferenceStatus(null));
  }, []);

  if (!isUnlocked) return <Navigate to="/parent" replace />;

  const toggleFocusApp = (bundle: string) => {
    setFocusApps((prev) =>
      prev.includes(bundle) ? prev.filter((b) => b !== bundle) : [...prev, bundle]
    );
  };

  const addCustomBundle = () => {
    const trimmed = customBundle.trim();
    if (trimmed && !focusApps.includes(trimmed)) {
      setFocusApps((prev) => [...prev, trimmed]);
      setCustomBundle("");
    }
  };

  const toggleDebugMode = async (enabled: boolean) => {
    setDebugMode(enabled);
    await invoke("set_debug_mode", { enabled });
  };

  const save = async () => {
    if (apiKey.trim()) {
      await invoke("save_claude_api_key", { apiKey: apiKey.trim() });
    }
    if (openAiApiKey.trim()) {
      await invoke("save_openai_api_key", { apiKey: openAiApiKey.trim() });
    }
    await invoke("save_setting", { key: "llm_provider", value: llmProvider });
    await invoke("save_setting", { key: "child_name", value: childName });
    await invoke("save_setting", {
      key: "dim_sensitivity",
      value: String(sensitivity),
    });
    await invoke("save_setting", {
      key: "feedback_profile",
      value: feedbackProfile,
    });
    await invoke("save_setting", {
      key: "focus_apps",
      value: JSON.stringify(focusApps),
    });
    await invoke("save_setting", {
      key: "improve_attune",
      value: String(improveAttune),
    });
    await invoke("save_setting", {
      key: "audio_cues",
      value: String(audioCues),
    });
    await invoke("save_setting", {
      key: "training_daily_minutes",
      value: String(trainingDailyMinutes),
    });
    invoke<LlmSettingsStatus>("get_llm_settings")
      .then(setLlmStatus)
      .catch(() => {});
    setApiKey("");
    setOpenAiApiKey("");
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="space-y-8 max-w-lg">
      <div>
        <h1 className="text-2xl font-semibold">Settings</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Configure ML attention tracking, focus apps, and reports.
        </p>
      </div>

      <div className="space-y-4">
        <div>
          <Label>Inference engine</Label>
          <p className="text-sm mt-1">
            {inferenceStatus
              ? `${inferenceStatus.model_version} (engagement: ${inferenceStatus.engagement_loaded ? "on" : "off"}, affect: ${inferenceStatus.affect_loaded ? inferenceStatus.affect_source : "off"}, gaze: ${inferenceStatus.gaze_loaded ? "on" : "off"})`
              : "Checking..."}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            Affect uses HSEmotion (EfficientNet-B0) when converted via{" "}
            <code className="text-xs">npm run convert:affect</code>. Gaze uses pretrained
            MobileGaze (Gaze360) when bundled. Run{" "}
            <code className="text-xs">./scripts/bootstrap_inference.sh</code> once if models show off.
          </p>
        </div>

        <div>
          <Label htmlFor="child">Child&apos;s name (for reports)</Label>
          <Input
            id="child"
            value={childName}
            onChange={(e) => setChildName(e.target.value)}
            className="mt-1"
          />
        </div>

        <div className="space-y-4 pt-2 border-t border-border">
          <div>
            <Label htmlFor="llm-provider">AI provider for reports</Label>
            <select
              id="llm-provider"
              value={llmProvider}
              onChange={(e) => setLlmProvider(e.target.value as "claude" | "openai")}
              className="mt-1 w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="claude">Claude (Anthropic)</option>
              <option value="openai">OpenAI</option>
            </select>
            <p className="text-xs text-muted-foreground mt-1">
              Used for session summaries, weekly reports, and optional screening narratives.
              {llmStatus && (
                <>
                  {" "}
                  Active: {llmProvider === "openai" ? "OpenAI" : "Claude"}.
                  {llmProvider === "claude" && llmStatus.claude_configured && " Key saved."}
                  {llmProvider === "openai" && llmStatus.openai_configured && " Key saved."}
                </>
              )}
            </p>
          </div>

          <div>
            <Label htmlFor="apikey">Claude API key</Label>
            <Input
              id="apikey"
              type="password"
              placeholder={
                llmStatus?.claude_configured ? "•••••••• (saved — enter to replace)" : "sk-ant-..."
              }
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              className="mt-1"
            />
          </div>

          <div>
            <Label htmlFor="openai-apikey">OpenAI API key</Label>
            <Input
              id="openai-apikey"
              type="password"
              placeholder={
                llmStatus?.openai_configured ? "•••••••• (saved — enter to replace)" : "sk-..."
              }
              value={openAiApiKey}
              onChange={(e) => setOpenAiApiKey(e.target.value)}
              className="mt-1"
            />
            <p className="text-xs text-muted-foreground mt-1">
              Keys are stored locally on this device. Leave blank to keep an existing saved key.
            </p>
          </div>
        </div>

        <div>
          <Label>Focus apps (allowlist)</Label>
          <p className="text-xs text-muted-foreground mb-2">
            Apps on this list are treated as on-task. Others may trigger gentle redirects.
          </p>
          <div className="space-y-2">
            {COMMON_FOCUS_APPS.map((app) => (
              <label key={app.bundle} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={focusApps.includes(app.bundle)}
                  onChange={() => toggleFocusApp(app.bundle)}
                />
                {app.label}
                <span className="text-muted-foreground text-xs">{app.bundle}</span>
              </label>
            ))}
          </div>
          <div className="flex gap-2 mt-2">
            <Input
              placeholder="com.example.app bundle ID"
              value={customBundle}
              onChange={(e) => setCustomBundle(e.target.value)}
            />
            <Button type="button" variant="outline" onClick={addCustomBundle}>
              Add
            </Button>
          </div>
        </div>

        <div>
          <Label>Dim sensitivity ({sensitivity}/100)</Label>
          <p className="text-xs text-muted-foreground mb-2">
            Higher = dim only when attention is lower. Gaze-away drift uses a faster path
            regardless of this setting.
          </p>
          <Slider
            value={[sensitivity]}
            min={40}
            max={90}
            step={5}
            onValueChange={([v]) => setSensitivity(v)}
          />
        </div>

        <div className="pt-2 border-t border-border space-y-4">
          <div>
            <h2 className="text-sm font-semibold">Train mode</h2>
            <p className="text-xs text-muted-foreground mt-1">
              Daily mission-minute budget (EndeavorRx-style dosing). Lockout applies after
              this many minutes of gameplay per day.
            </p>
          </div>
          <div>
            <Label>Daily training budget ({trainingDailyMinutes} min)</Label>
            <Slider
              value={[trainingDailyMinutes]}
              min={10}
              max={40}
              step={5}
              onValueChange={([v]) => setTrainingDailyMinutes(v)}
            />
          </div>
        </div>

        <div className="pt-2 border-t border-border space-y-4">
          <div>
            <h2 className="text-sm font-semibold">Session feedback</h2>
            <p className="text-xs text-muted-foreground mt-1">
              Visual dim and audio cues during active learning sessions.
            </p>
          </div>

          <div>
            <Label htmlFor="profile">Feedback style</Label>
            <p className="text-xs text-muted-foreground mb-2">
              Gentle uses slower blur and longer grace periods (recommended for ADHD).
            </p>
            <select
              id="profile"
              value={feedbackProfile}
              onChange={(e) => setFeedbackProfile(e.target.value)}
              className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="gentle">Gentle</option>
              <option value="standard">Standard</option>
              <option value="strong">Strong</option>
            </select>
          </div>

          <div>
            <label className="flex items-center gap-2 text-sm font-medium">
              <input
                type="checkbox"
                checked={audioCues}
                onChange={(e) => setAudioCues(e.target.checked)}
              />
              Audio dim cue
            </label>
            <p className="text-xs text-muted-foreground mt-1 ml-6">
              Gentle chime when the screen dims for attention (not on soft nudge or refocus).
              Requires an active session and Mac volume on.
            </p>
          </div>
        </div>

        <div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={improveAttune}
              onChange={(e) => setImproveAttune(e.target.checked)}
            />
            Help improve Attune (save ML feature data locally for training)
          </label>
        </div>

        <div className="pt-4 border-t border-border">
          <h2 className="text-sm font-semibold">Advanced / Developer</h2>
          <p className="text-xs text-muted-foreground mt-1 mb-3">
            Tools for debugging session behavior during development.
          </p>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={debugMode}
              onChange={(e) => toggleDebugMode(e.target.checked)}
            />
            Debug mode
          </label>
          <p className="text-xs text-muted-foreground mt-1">
            Shows a floating diagnostic panel during sessions. For development only.
          </p>
        </div>

        <Button onClick={save}>{saved ? "Saved!" : "Save Settings"}</Button>
      </div>
    </div>
  );
}

import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useNavigate, useParams, Navigate } from "react-router-dom";
import { useAttune } from "@/contexts/attune.context";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

interface ScreeningEvidence {
  metric: string;
  observed_value: number;
  reference_p25: number | null;
  reference_p50: number | null;
  reference_p75: number | null;
}

interface ScreeningInsight {
  id: string;
  construct: string;
  severity: string;
  headline: string;
  what_we_saw: string;
  why_it_matters: string;
  possible_contributors: string[];
  confidence: string;
  evidence: ScreeningEvidence;
}

interface ScreeningQuality {
  overall: string;
  face_present_ratio: number;
  mean_face_quality: number;
  gaze_model_ok: boolean;
  model_version: string;
  valid_antisaccade_trials: number;
  minimum_trials_met: boolean;
  issues: string[];
  retest_guidance: string | null;
}

interface TrialScore {
  task_id: string;
  trial_index: number;
  cue_side: string;
  expected_gaze_side: string;
  scored: boolean;
  saccade_latency_ms: number | null;
  direction_error: boolean | null;
  anticipatory: boolean;
  gaze_direction: string | null;
}

interface TrialTaskSummary {
  task_id: string;
  trial_count: number;
  scored_count: number;
  error_count: number;
  error_rate: number;
  mean_latency_ms: number;
  trials: TrialScore[];
}

interface ScreeningFeatureSet {
  task_id: string;
  sample_count: number;
  face_present_ratio: number;
  mean_gaze_away: number;
  mean_face_quality: number;
  pct_on_screen: number;
  blink_rate_per_min: number;
  yaw_std: number;
  pitch_std: number;
  fixation_count: number;
  mean_fixation_duration_ms: number;
  saccade_count: number;
  mean_saccade_latency_ms: number;
}

interface NaturalisticFeatureSet {
  task_id: string;
  sample_count: number;
  face_present_ratio: number;
  on_screen_pct: number;
  gaze_variability: number;
  engagement_mean: number;
  vigilance_decay: number;
  lapse_episodes: number;
}

interface ScreeningFlag {
  code: string;
  message: string;
  severity: string;
}

interface ScreeningReport {
  screening_id: string;
  generated_at: number;
  disclaimer: string;
  child_age: number;
  baseline_yaw: number;
  features_by_task: ScreeningFeatureSet[];
  trial_summaries: TrialTaskSummary[];
  naturalistic_features: NaturalisticFeatureSet | null;
  quality: ScreeningQuality;
  insights: ScreeningInsight[];
  summary_text: string;
  flags: ScreeningFlag[];
  classifier_available: boolean;
  classifier_prediction: number | null;
  classifier_label: string | null;
}

const TASK_LABELS: Record<string, string> = {
  fixation: "Central fixation",
  prosaccade: "Prosaccade (look at cue)",
  antisaccade: "Antisaccade (look away)",
  naturalistic_viewing: "Story viewing (sustained attention)",
  story_probe: "Story gaze probes (follow character)",
};

const CONSTRUCT_LABELS: Record<string, string> = {
  sustained_attention: "Sustained attention",
  ecological_attention: "Naturalistic / story attention",
  orienting_speed: "Orienting / processing speed",
  response_inhibition: "Response inhibition",
  data_validity: "Data quality",
};

function qualityBadgeClass(overall: string) {
  if (overall === "high") return "border-emerald-500/40 bg-emerald-500/5 text-emerald-800 dark:text-emerald-200";
  if (overall === "medium") return "border-amber-500/40 bg-amber-500/5 text-amber-800 dark:text-amber-200";
  return "border-red-500/40 bg-red-500/5 text-red-800 dark:text-red-200";
}

function formatReference(ev: ScreeningEvidence): string {
  if (ev.reference_p25 == null || ev.reference_p75 == null) return "—";
  if (ev.metric.includes("rate") || ev.metric.includes("pct")) {
    return `${(ev.reference_p25 * (ev.metric.includes("rate") ? 100 : 1)).toFixed(0)}–${(ev.reference_p75 * (ev.metric.includes("rate") ? 100 : 1)).toFixed(0)}${ev.metric.includes("pct") ? "%" : "% err"}`;
  }
  return `${ev.reference_p25.toFixed(0)}–${ev.reference_p75.toFixed(0)}`;
}

export function ParentScreeningReport() {
  const { screeningId } = useParams<{ screeningId: string }>();
  const { isUnlocked } = useAttune();
  const navigate = useNavigate();
  const [report, setReport] = useState<ScreeningReport | null>(null);
  const [labelSaved, setLabelSaved] = useState(false);
  const [expandedInsight, setExpandedInsight] = useState<string | null>(null);
  const [priorErrorRate, setPriorErrorRate] = useState<number | null>(null);
  const [narrativeLoading, setNarrativeLoading] = useState(false);
  const [narrativeError, setNarrativeError] = useState<string | null>(null);

  useEffect(() => {
    if (!isUnlocked || !screeningId) return;
    invoke<ScreeningReport>("get_screening_report", { screeningId })
      .then(setReport)
      .catch(console.error);
    invoke<number | null>("get_prior_screening_error_rate", { excludeId: screeningId })
      .then(setPriorErrorRate)
      .catch(() => setPriorErrorRate(null));
  }, [isUnlocked, screeningId]);

  if (!isUnlocked) return <Navigate to="/parent" replace />;
  if (!report) {
    return <p className="text-muted-foreground text-sm">Loading report…</p>;
  }

  const anti = report.trial_summaries.find((t) => t.task_id === "antisaccade");

  const saveLabel = async (label: number, source: string) => {
    if (!screeningId) return;
    await invoke("save_screening_label", {
      screeningId,
      label,
      labelSource: source,
    });
    setLabelSaved(true);
  };

  const requestNarrative = async () => {
    if (!screeningId) return;
    setNarrativeLoading(true);
    setNarrativeError(null);
    try {
      const text = await invoke<string>("generate_screening_summary", { screeningId });
      setReport((r) => (r ? { ...r, summary_text: text } : r));
    } catch (e) {
      setNarrativeError(String(e));
    } finally {
      setNarrativeLoading(false);
    }
  };

  return (
    <div className="space-y-8 max-w-2xl">
      <div>
        <Button variant="ghost" size="sm" onClick={() => navigate("/parent/screening")}>
          ← Back to screening
        </Button>
        <h1 className="text-2xl font-semibold mt-4">Screening report</h1>
        <p className="text-muted-foreground text-sm mt-2">{report.disclaimer}</p>
      </div>

      <div className={`rounded-xl border p-4 text-sm ${qualityBadgeClass(report.quality.overall)}`}>
        <p className="font-medium capitalize">Data quality: {report.quality.overall}</p>
        <ul className="mt-2 space-y-1 text-xs opacity-90">
          <li>Face visible: {(report.quality.face_present_ratio * 100).toFixed(0)}%</li>
          <li>Gaze model: {report.quality.model_version}{report.quality.gaze_model_ok ? "" : " (bootstrap recommended)"}</li>
          <li>Antisaccade trials scored: {report.quality.valid_antisaccade_trials}/8</li>
        </ul>
        {report.quality.issues.length > 0 && (
          <ul className="mt-2 list-disc pl-5 text-xs">
            {report.quality.issues.map((issue) => (
              <li key={issue}>{issue}</li>
            ))}
          </ul>
        )}
      </div>

      <div className="space-y-3">
        <h2 className="text-lg font-medium">Session summary</h2>
        <div className="rounded-xl border border-border p-4 text-sm leading-relaxed whitespace-pre-wrap">
          {report.summary_text}
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button variant="outline" size="sm" disabled={narrativeLoading} onClick={requestNarrative}>
            {narrativeLoading ? "Generating…" : "Enhance with AI (optional)"}
          </Button>
        </div>
        {narrativeError && (
          <p className="text-xs text-muted-foreground">{narrativeError}</p>
        )}
      </div>

      {anti && priorErrorRate != null && (
        <p className="text-sm text-muted-foreground rounded-lg border border-border p-3">
          Compared with your previous screening, antisaccade error rate was{" "}
          {(anti.error_rate * 100).toFixed(0)}% now vs {(priorErrorRate * 100).toFixed(0)}% last time.
        </p>
      )}

      {report.insights.filter((i) => i.construct !== "data_validity").length > 0 && (
        <div className="space-y-2">
          <h2 className="text-lg font-medium">Why these patterns</h2>
          {report.insights
            .filter((i) => i.construct !== "data_validity")
            .map((insight) => (
              <div key={insight.id} className="rounded-lg border border-border overflow-hidden">
                <button
                  type="button"
                  className="w-full text-left px-4 py-3 text-sm hover:bg-muted/40"
                  onClick={() =>
                    setExpandedInsight(expandedInsight === insight.id ? null : insight.id)
                  }
                >
                  <span className="font-medium">{insight.headline}</span>
                  <span className="block text-xs text-muted-foreground mt-1">
                    {CONSTRUCT_LABELS[insight.construct] ?? insight.construct} · confidence:{" "}
                    {insight.confidence}
                  </span>
                </button>
                {expandedInsight === insight.id && (
                  <div className="px-4 pb-4 text-sm space-y-2 border-t border-border pt-3">
                    <p>{insight.what_we_saw}</p>
                    <p className="text-muted-foreground">{insight.why_it_matters}</p>
                    <p className="text-xs">
                      Observed {insight.evidence.metric}:{" "}
                      <span className="tabular-nums font-medium text-foreground">
                        {insight.evidence.observed_value.toFixed(
                          insight.evidence.metric.includes("rate") ? 2 : 0,
                        )}
                      </span>
                      {insight.evidence.reference_p25 != null && (
                        <> · research reference band: {formatReference(insight.evidence)}</>
                      )}
                    </p>
                    {insight.possible_contributors.length > 0 && (
                      <p className="text-xs text-muted-foreground">
                        Other factors: {insight.possible_contributors.join("; ")}
                      </p>
                    )}
                  </div>
                )}
              </div>
            ))}
        </div>
      )}

      {report.trial_summaries.length > 0 && (
        <div className="space-y-4">
          <h2 className="text-lg font-medium">Trial-level results</h2>
          {report.trial_summaries.map((summary) => (
            <div key={summary.task_id} className="rounded-xl border border-border p-4 space-y-2">
              <p className="font-medium">{TASK_LABELS[summary.task_id] ?? summary.task_id}</p>
              <p className="text-sm text-muted-foreground">
                {summary.scored_count}/{summary.trial_count} trials scored ·{" "}
                {summary.task_id === "antisaccade"
                  ? `error rate ${(summary.error_rate * 100).toFixed(0)}%`
                  : summary.task_id === "story_probe"
                    ? `follow rate ${((1 - summary.error_rate) * 100).toFixed(0)}%`
                    : `mean latency ${summary.mean_latency_ms.toFixed(0)} ms`}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {summary.trials.map((t) => (
                  <span
                    key={`${t.task_id}-${t.trial_index}`}
                    title={
                      t.scored
                        ? `${t.cue_side} cue → ${t.gaze_direction ?? "?"}${t.direction_error ? " (error)" : ""}`
                        : "not scored"
                    }
                    className={`text-xs px-2 py-0.5 rounded-full border ${
                      !t.scored
                        ? "border-muted text-muted-foreground"
                        : t.direction_error
                          ? "border-amber-500/50 text-amber-700 dark:text-amber-300"
                          : "border-emerald-500/40 text-emerald-700 dark:text-emerald-300"
                    }`}
                  >
                    {t.trial_index + 1}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {report.naturalistic_features && (
        <div className="rounded-xl border border-border p-4 space-y-2">
          <p className="font-medium">Story viewing metrics</p>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm text-muted-foreground">
            <span>On-screen attention</span>
            <span className="text-foreground tabular-nums">
              {report.naturalistic_features.on_screen_pct.toFixed(0)}%
            </span>
            <span>Gaze variability</span>
            <span className="text-foreground tabular-nums">
              {report.naturalistic_features.gaze_variability.toFixed(3)}
            </span>
            <span>Engagement (model)</span>
            <span className="text-foreground tabular-nums">
              {(report.naturalistic_features.engagement_mean * 100).toFixed(0)}%
            </span>
            <span>Vigilance change (2nd − 1st half)</span>
            <span className="text-foreground tabular-nums">
              {report.naturalistic_features.vigilance_decay.toFixed(0)} pts
            </span>
            <span>Attention lapses (2s+)</span>
            <span className="text-foreground tabular-nums">
              {report.naturalistic_features.lapse_episodes}
            </span>
          </div>
        </div>
      )}

      <div className="space-y-4">
        <h2 className="text-lg font-medium">What we measured</h2>
        {report.features_by_task.map((f) => (
          <div key={f.task_id} className="rounded-xl border border-border p-4 space-y-2">
            <p className="font-medium">{TASK_LABELS[f.task_id] ?? f.task_id}</p>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm text-muted-foreground">
              <span>On-screen attention</span>
              <span className="text-foreground tabular-nums">{f.pct_on_screen.toFixed(0)}%</span>
              <span>Gaze stability (yaw)</span>
              <span className="text-foreground tabular-nums">{f.yaw_std.toFixed(3)}</span>
              <span>Fixations</span>
              <span className="text-foreground tabular-nums">{f.fixation_count}</span>
              <span>Mean fixation</span>
              <span className="text-foreground tabular-nums">
                {f.mean_fixation_duration_ms.toFixed(0)} ms
              </span>
              <span>Blink rate</span>
              <span className="text-foreground tabular-nums">
                {f.blink_rate_per_min.toFixed(1)}/min
              </span>
            </div>
          </div>
        ))}
      </div>

      <div className="rounded-xl border border-border p-4 text-sm text-muted-foreground leading-relaxed space-y-3">
        <p className="font-medium text-foreground">How this relates to ADHD research</p>
        <p>
          This screening uses short oculomotor tasks studied in attention research—fixation
          (sustained focus), prosaccade (orienting), antisaccade (inhibition), and a brief
          watch-along story (naturalistic sustained attention). Patterns in these tasks overlap
          with executive attention networks but are measured via webcam gaze, not clinical eye
          tracking or brainwave (EEG) neurofeedback. Results are a screening aid only and cannot
          diagnose ADHD.
        </p>
        <Button variant="link" className="h-auto p-0 text-sm" onClick={() => navigate("/parent/science")}>
          View future EEG integration roadmap →
        </Button>
      </div>

      {report.classifier_available && report.classifier_label && (
        <div className="rounded-xl border border-primary/30 p-4 text-sm">
          <p className="font-medium">Research classifier (validated cohort only)</p>
          <p className="text-muted-foreground mt-1">{report.classifier_label}</p>
          {report.classifier_prediction != null && (
            <p className="text-xs tabular-nums mt-1">
              Score: {(report.classifier_prediction * 100).toFixed(0)}%
            </p>
          )}
        </div>
      )}

      <div className="rounded-xl border border-border p-4 space-y-3">
        <Label>Optional: help improve future models (stored locally)</Label>
        <p className="text-xs text-muted-foreground">
          Has a clinician or formal assessment suggested ADHD traits for your child?
        </p>
        <div className="flex gap-2 flex-wrap">
          <Button
            variant="outline"
            size="sm"
            disabled={labelSaved}
            onClick={() => saveLabel(1, "parent_clinical_hint")}
          >
            Yes, indicator noted
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={labelSaved}
            onClick={() => saveLabel(0, "parent_typical")}
          >
            No / not sure
          </Button>
        </div>
        {labelSaved && (
          <p className="text-xs text-muted-foreground">Thank you — label saved on device.</p>
        )}
      </div>
    </div>
  );
}

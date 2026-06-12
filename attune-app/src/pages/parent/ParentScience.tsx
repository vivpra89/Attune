import { Navigate, useNavigate } from "react-router-dom";
import { useAttune } from "@/contexts/attune.context";
import { Button } from "@/components/ui/button";

const PHASES = [
  {
    id: "0",
    title: "Foundation (today)",
    status: "complete" as const,
    summary:
      "Webcam oculomotor screening with trial-level antisaccade scoring, age-banded norms, data quality gates, and explainable summaries.",
  },
  {
    id: "1",
    title: "Hardware layer",
    status: "planned" as const,
    summary:
      "Device abstraction for consumer EEG headsets (Muse, Emotiv, OpenBCI). Signal quality only—no clinical claims.",
  },
  {
    id: "2",
    title: "qEEG baseline",
    status: "planned" as const,
    summary:
      "Short eyes-open/closed baseline. Individual alpha frequency and SMR/theta phenotype tags to suggest NF protocol direction—not diagnosis.",
  },
  {
    id: "3",
    title: "Protocol-guided neurofeedback",
    status: "planned" as const,
    summary:
      "Optional theta/beta or SMR training during learning sessions with compliance tracking (time-in-zone). Adjunct only, not a replacement for clinical care.",
  },
  {
    id: "4",
    title: "Multimodal fusion",
    status: "planned" as const,
    summary:
      "Combine oculomotor and EEG in one explainable report. Downgrade confidence when modalities disagree.",
  },
  {
    id: "5",
    title: "Clinical validation",
    status: "planned" as const,
    summary:
      "IRB studies, sham-controlled NF trials, and regulatory review before any diagnostic or treatment claims.",
  },
];

export function ParentScience() {
  const { isUnlocked } = useAttune();
  const navigate = useNavigate();

  if (!isUnlocked) return <Navigate to="/parent" replace />;

  return (
    <div className="space-y-8 max-w-2xl">
      <div>
        <Button variant="ghost" size="sm" onClick={() => navigate("/parent/screening")}>
          ← Back
        </Button>
        <h1 className="text-2xl font-semibold mt-4">Science &amp; EEG roadmap</h1>
        <p className="text-muted-foreground text-sm mt-2 leading-relaxed">
          Attune&apos;s screening today uses webcam eye-movement tasks linked to executive
          attention research. EEG neurofeedback is{" "}
          <strong className="font-medium text-foreground">not available yet</strong>—this page
          describes how we plan to add it responsibly.
        </p>
      </div>

      <div className="rounded-xl border border-border p-4 text-sm leading-relaxed">
        <p className="font-medium">What we believe</p>
        <ul className="mt-2 list-disc pl-5 space-y-1 text-muted-foreground">
          <li>
            Oculomotor screening measures observable inhibition and attention behaviors—our
            primary trust layer.
          </li>
          <li>
            EEG can complement screening by mapping spectral profiles (e.g. SMR, frontal theta)—
            not by relying on theta/beta ratio alone as a diagnostic test.
          </li>
          <li>
            Neurofeedback may help some children as an adjunct over many sessions, but evidence
            is mixed; sham-controlled studies are required before treatment claims.
          </li>
          <li>All raw EEG would stay on-device by default, like video today.</li>
        </ul>
      </div>

      <div className="space-y-3">
        <h2 className="text-lg font-medium">Integration phases</h2>
        {PHASES.map((phase) => (
          <div
            key={phase.id}
            className="rounded-xl border border-border p-4 space-y-1"
          >
            <div className="flex items-center justify-between gap-2">
              <p className="font-medium">
                Phase {phase.id}: {phase.title}
              </p>
              <span
                className={
                  phase.status === "complete"
                    ? "text-xs px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                    : "text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground"
                }
              >
                {phase.status === "complete" ? "Complete" : "Planned"}
              </span>
            </div>
            <p className="text-sm text-muted-foreground">{phase.summary}</p>
          </div>
        ))}
      </div>

      <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 text-sm">
        <p className="font-medium text-amber-900 dark:text-amber-200">What we will not claim</p>
        <ul className="mt-2 list-disc pl-5 space-y-1 text-muted-foreground">
          <li>EEG or theta/beta ratio alone diagnoses ADHD</li>
          <li>Neurofeedback replaces medication or clinician evaluation</li>
          <li>Brainwave training works for every child without validation</li>
        </ul>
      </div>

      <p className="text-xs text-muted-foreground">
        Full technical roadmap:{" "}
        <code className="text-[11px]">docs/EEG_INTEGRATION_ROADMAP.md</code> in the Attune
        repository.
      </p>
    </div>
  );
}

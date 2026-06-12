import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Navigate } from "react-router-dom";
import { useAttune } from "@/contexts/attune.context";

interface WeeklyReportRow {
  id: string;
  week_start: number;
  report_json: string;
  created_at: number;
}

export function ParentReports() {
  const { isUnlocked } = useAttune();
  const [reports, setReports] = useState<WeeklyReportRow[]>([]);

  useEffect(() => {
    invoke("ensure_weekly_report").finally(() => {
      invoke<WeeklyReportRow[]>("list_weekly_reports").then(setReports).catch(console.error);
    });
  }, []);

  if (!isUnlocked) return <Navigate to="/parent" replace />;

  return (
    <div className="space-y-8 overflow-y-auto pb-8">
      <div>
        <h1 className="text-2xl font-semibold">Weekly Reports</h1>
        <p className="text-sm text-muted-foreground mt-1">
          AI-generated progress summaries you can share with teachers or therapists.
        </p>
      </div>

      {reports.length === 0 && (
        <p className="text-sm text-muted-foreground">
          Complete a few sessions to generate your first weekly report.
        </p>
      )}

      {reports.map((r) => (
        <div key={r.id} className="rounded-xl border border-border p-6">
          <p className="text-sm font-medium text-muted-foreground mb-3">
            Week of{" "}
            {new Date(r.week_start * 1000).toLocaleDateString(undefined, {
              month: "long",
              day: "numeric",
              year: "numeric",
            })}
          </p>
          <div className="text-sm leading-relaxed whitespace-pre-wrap">
            {r.report_json}
          </div>
        </div>
      ))}
    </div>
  );
}

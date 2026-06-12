import { BrowserRouter as Router, Routes, Route, Navigate } from "react-router-dom";
import App from "@/pages/app";
import { ParentLayout } from "@/layouts/ParentLayout";
import { ParentGate } from "@/pages/parent/ParentGate";
import { ParentToday } from "@/pages/parent/ParentToday";
import { ParentSession } from "@/pages/parent/ParentSession";
import { ParentReports } from "@/pages/parent/ParentReports";
import { ParentSettings } from "@/pages/parent/ParentSettings";
import { ParentSetup } from "@/pages/parent/ParentSetup";
import { ParentScreening } from "@/pages/parent/ParentScreening";
import { ParentScreeningRun } from "@/pages/parent/ParentScreeningRun";
import { ParentScreeningReport } from "@/pages/parent/ParentScreeningReport";
import { ParentScience } from "@/pages/parent/ParentScience";
import { ParentTrain } from "@/pages/parent/ParentTrain";
import { ParentTrainMission } from "@/pages/parent/ParentTrainMission";
import { ParentTrainReport } from "@/pages/parent/ParentTrainReport";

export default function AppRoutes() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<App />} />
        <Route path="/parent" element={<ParentLayout />}>
          <Route index element={<ParentGate />} />
          <Route path="today" element={<ParentToday />} />
          <Route path="session/:sessionId" element={<ParentSession />} />
          <Route path="reports" element={<ParentReports />} />
          <Route path="settings" element={<ParentSettings />} />
          <Route path="setup" element={<ParentSetup />} />
          <Route path="screening" element={<ParentScreening />} />
          <Route path="screening/run" element={<ParentScreeningRun />} />
          <Route path="screening/report/:screeningId" element={<ParentScreeningReport />} />
          <Route path="science" element={<ParentScience />} />
          <Route path="train" element={<ParentTrain />} />
          <Route path="train/mission" element={<ParentTrainMission />} />
          <Route path="train/report/:sessionId" element={<ParentTrainReport />} />
        </Route>
        <Route path="*" element={<Navigate to="/parent" replace />} />
      </Routes>
    </Router>
  );
}

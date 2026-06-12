import React from "react";
import ReactDOM from "react-dom/client";
import AttentionDimOverlay from "./components/AttentionDimOverlay";
import SessionDebugOverlay from "./components/SessionDebugOverlay";
import { AttuneProvider } from "./contexts/attune.context";
import { ThemeProvider } from "./contexts/theme.context";
import "./global.css";
import { getCurrentWindow } from "@tauri-apps/api/window";
import AppRoutes from "./routes";

const currentWindow = getCurrentWindow();
const windowLabel = currentWindow.label;

if (windowLabel === "debug-overlay") {
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <SessionDebugOverlay />
    </React.StrictMode>
  );
} else if (windowLabel.startsWith("attention-dim-")) {
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <AttentionDimOverlay />
    </React.StrictMode>
  );
} else {
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <ThemeProvider>
        <AttuneProvider>
          <AppRoutes />
        </AttuneProvider>
      </ThemeProvider>
    </React.StrictMode>
  );
}

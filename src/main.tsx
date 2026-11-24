import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";

/**
 * Apply the persisted theme before React paints. This replaces an inline script,
 * which Manifest V3's extension-page CSP would refuse to execute.
 */
function applyInitialTheme() {
  try {
    const raw = localStorage.getItem("dispatch.workspace.v1");
    const theme = raw ? (JSON.parse(raw).settings || {}).theme : "light";
    const dark =
      theme === "dark" ||
      (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.classList.toggle("dark", dark);
  } catch {
    document.documentElement.classList.remove("dark");
  }
}

applyInitialTheme();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);

import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
import { logError } from "./lib/log";

// Errors outside React (rejected promises nobody awaited, throws in timers
// and listeners) go to the app log instead of disappearing.
window.addEventListener("unhandledrejection", (e) => {
  const r = e.reason as Error | undefined;
  void logError(`[unhandledrejection] ${r?.message ?? String(e.reason)}`, r?.stack ?? "");
});
window.addEventListener("error", (e) => {
  void logError(`[error] ${e.message}`, (e.error as Error | undefined)?.stack ?? "");
});

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

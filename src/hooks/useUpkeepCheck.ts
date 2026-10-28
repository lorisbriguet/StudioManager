import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { runUpkeepCheck } from "../lib/upkeep/notify";
import { logError } from "../lib/log";
import { todayLocalISO } from "../utils/localDate";

const MIN_INTERVAL_MS = 60 * 60 * 1000;

/** Upkeep and renewal checks: on start and on window focus, at most once an hour. */
export function useUpkeepCheck() {
  const qc = useQueryClient();
  const lastRun = useRef(0);
  const running = useRef(false);

  useEffect(() => {
    const run = () => {
      const now = Date.now();
      if (running.current || now - lastRun.current < MIN_INTERVAL_MS) return;
      running.current = true;
      lastRun.current = now;
      runUpkeepCheck(qc, todayLocalISO())
        .catch((e) => logError("Upkeep check failed:", e))
        .finally(() => { running.current = false; });
    };
    run();
    window.addEventListener("focus", run);
    return () => window.removeEventListener("focus", run);
  }, [qc]);
}

import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { runUpkeepCheck } from "../lib/upkeep/notify";
import { runConnectionSyncs, SYNC_INTERVAL_MS } from "../lib/upkeep/connections";
import { logError } from "../lib/log";
import { todayLocalISO } from "../utils/localDate";

const MIN_INTERVAL_MS = 60 * 60 * 1000;

/**
 * Upkeep and renewal checks: on start and on window focus, at most once an
 * hour. Connection syncs: on start and every 6 hours while the app is open
 * (each connection is skipped when it synced less than 6 hours ago).
 */
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
    const sync = () => {
      runConnectionSyncs(qc).catch((e) => logError("Connection sync failed:", e));
    };
    run();
    sync();
    const timer = window.setInterval(sync, SYNC_INTERVAL_MS);
    window.addEventListener("focus", run);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", run);
    };
  }, [qc]);
}

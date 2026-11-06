import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { listen } from "@tauri-apps/api/event";
import { syncAllUpkeepEvents } from "../lib/upkeep/calendar";
import { keysForTools, touchesCalendar } from "../lib/agentChangeKeys";
import { logError } from "../lib/log";

/**
 * An agent (the MCP server) wrote to a database; the Rust side emits
 * `db-changed` with the tools it logged since the last event (`null` when it
 * could not tell). Once the burst settles, refetch the queries those tools
 * touch (everything when unsure), then, if an upkeep or subscription tool
 * ran, give the rows an agent added or moved their calendar event (the
 * server never touches Apple Calendar). Rows already in step are left alone.
 */
export function useDbChangedListener(delayMs = 400) {
  const queryClient = useQueryClient();
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    // Tools seen in this burst; null once any event could not name them.
    let pending: string[] | null = [];
    listen<string[] | null>("db-changed", (event) => {
      const tools = Array.isArray(event.payload) ? event.payload : null;
      pending = pending === null || tools === null ? null : [...pending, ...tools];
      clearTimeout(timer);
      timer = setTimeout(() => {
        const burst = pending;
        pending = [];
        const keys = keysForTools(burst);
        if (keys === null) void queryClient.invalidateQueries();
        else for (const key of keys) void queryClient.invalidateQueries({ queryKey: [key] });
        if (touchesCalendar(burst)) {
          syncAllUpkeepEvents().catch((e) => logError("Upkeep calendar sync after agent change failed:", e));
        }
      }, delayMs);
    })
      .then((fn) => {
        if (cancelled) fn();
        else unlisten = fn;
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      clearTimeout(timer);
      unlisten?.();
    };
  }, [queryClient, delayMs]);
}

import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { listen } from "@tauri-apps/api/event";
import { syncAllUpkeepEvents } from "../lib/upkeep/calendar";
import { logError } from "../lib/log";

/**
 * An agent (the MCP server) wrote to a database; the Rust side emits
 * `db-changed`. Refetch everything once the burst settles, then give upkeep
 * items and subscriptions an agent added or moved their calendar event (the
 * server never touches Apple Calendar). Rows already in step are left alone.
 */
export function useDbChangedListener(delayMs = 400) {
  const queryClient = useQueryClient();
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    listen("db-changed", () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        void queryClient.invalidateQueries();
        syncAllUpkeepEvents().catch((e) => logError("Upkeep calendar sync after agent change failed:", e));
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

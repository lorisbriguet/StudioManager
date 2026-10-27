import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { listen } from "@tauri-apps/api/event";

/**
 * An agent (the MCP server) wrote to a database; the Rust side emits
 * `db-changed`. Refetch everything once the burst settles.
 */
export function useDbChangedListener(delayMs = 400) {
  const queryClient = useQueryClient();
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    listen("db-changed", () => {
      clearTimeout(timer);
      timer = setTimeout(() => void queryClient.invalidateQueries(), delayMs);
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

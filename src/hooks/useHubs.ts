import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { listen } from "@tauri-apps/api/event";
import { hubCounts, type HubView } from "../lib/hubs";
import { isDemoBuild } from "../lib/demoBuild";
import { qk } from "../db/queryKeys";
import { useAppStore } from "../stores/app-store";

/**
 * The hubs with their counts, read every 5 minutes and whenever Rust says a run ended
 * (`hubs-changed`). Never invoked in the demo build or while Agents is off. An error (a closed
 * gate: a mode) is not retried in a loop; callers read it from `error` and count no hubs.
 */
export function useHubs() {
  const agentsEnabled = useAppStore((s) => s.agentsEnabled);
  const enabled = agentsEnabled && !isDemoBuild();
  const qc = useQueryClient();
  useEffect(() => {
    if (!enabled) return;
    let off: (() => void) | undefined;
    let gone = false;
    listen("hubs-changed", () => void qc.invalidateQueries({ queryKey: qk.hubs.all }))
      .then((fn) => {
        if (gone) fn();
        else off = fn;
      })
      .catch(() => {});
    return () => {
      gone = true;
      off?.();
    };
  }, [enabled, qc]);
  return useQuery({
    queryKey: qk.hubs.list,
    queryFn: hubCounts,
    refetchInterval: 5 * 60_000,
    retry: false,
    enabled,
  });
}

/** The hubs to show: none while the read failed or is off. */
export function useHubList(): HubView[] {
  const q = useHubs();
  return q.isError ? [] : (q.data ?? []);
}

/** What the sidebar and the menu bar add: the waiting items of hubs whose count is fresh. */
export function useHubWaiting(): number {
  return useHubList().reduce((n, h) => n + (h.fresh ? (h.waiting ?? 0) : 0), 0);
}

import { useEffect } from "react";
import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { listen } from "@tauri-apps/api/event";
import { hubCounts, type HubView } from "../lib/hubs";
import { isDemoBuild } from "../lib/demoBuild";
import { qk } from "../db/queryKeys";
import { useAppStore } from "../stores/app-store";

let users = 0;
let unlisten: (() => void) | undefined;
let generation = 0;

/** One `hubs-changed` listener for the whole app, however many callers use the hubs. */
function acquireListener(qc: QueryClient) {
  users += 1;
  if (users > 1) return;
  const mine = ++generation;
  listen("hubs-changed", () => void qc.invalidateQueries({ queryKey: qk.hubs.all }))
    .then((fn) => {
      if (mine !== generation || users === 0) fn();
      else unlisten = fn;
    })
    .catch(() => {});
}

function releaseListener() {
  users -= 1;
  if (users > 0) return;
  generation += 1;
  unlisten?.();
  unlisten = undefined;
}

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
    acquireListener(qc);
    return releaseListener;
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

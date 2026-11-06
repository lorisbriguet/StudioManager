import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { AGENTS_CHANGED, listAgents, watchAgents, type Agent, type Group } from "../../lib/agents";

/** A view on screen tells the poller every this often (its fast pace lasts 8 s per call). */
export const WATCH_EVERY_MS = 3_000;

export const GROUPS: Group[] = ["needs-you", "working", "idle", "done"];

export function groupAgents(agents: Agent[]): Record<Group, Agent[]> {
  const out: Record<Group, Agent[]> = { "needs-you": [], working: [], idle: [], done: [] };
  for (const a of agents) out[a.group].push(a);
  // Done reads as history: latest first.
  out.done.sort((a, b) => b.startedAt - a.startedAt);
  return out;
}

/**
 * The live agent list: one `listAgents()` call, then every `agents:changed` event. While the
 * window is visible it keeps the poller at its fast pace; hidden, the poller slows to 30 s.
 */
export function useAgents(): { agents: Agent[]; byGroup: Record<Group, Agent[]> } {
  const [agents, setAgents] = useState<Agent[]>([]);

  useEffect(() => {
    const watch = () => {
      if (document.visibilityState === "visible") watchAgents().catch(() => {});
    };
    watch();
    const timer = setInterval(watch, WATCH_EVERY_MS);
    document.addEventListener("visibilitychange", watch);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", watch);
    };
  }, []);

  useEffect(() => {
    let alive = true;
    let unlisten: (() => void) | null = null;
    listAgents()
      .then((list) => alive && setAgents(list))
      // "Agents are switched off" (or any failure) reads as an empty list.
      .catch(() => alive && setAgents([]));
    listen<Agent[]>(AGENTS_CHANGED, (e) => {
      if (alive) setAgents(e.payload);
    }).then((u) => {
      if (alive) unlisten = u;
      else u();
    });
    return () => {
      alive = false;
      unlisten?.();
    };
  }, []);

  return { agents, byGroup: groupAgents(agents) };
}

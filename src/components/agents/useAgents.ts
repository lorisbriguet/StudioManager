import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { AGENTS_CHANGED, listAgents, type Agent, type Group } from "../../lib/agents";

export const GROUPS: Group[] = ["needs-you", "working", "idle", "done"];

export function groupAgents(agents: Agent[]): Record<Group, Agent[]> {
  const out: Record<Group, Agent[]> = { "needs-you": [], working: [], idle: [], done: [] };
  for (const a of agents) out[a.group].push(a);
  // Done reads as history: latest first.
  out.done.sort((a, b) => b.startedAt - a.startedAt);
  return out;
}

/** The live agent list: one `listAgents()` call, then every `agents:changed` event. */
export function useAgents(): { agents: Agent[]; byGroup: Record<Group, Agent[]> } {
  const [agents, setAgents] = useState<Agent[]>([]);

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

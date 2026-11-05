import { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { open as openDirectory } from "@tauri-apps/plugin-dialog";
import { startAgent, startFolders, trustFolder, type StartFolder } from "../lib/agents";
import {
  agentName,
  agentPrompt,
  confirmTrust,
  isHomeFolder,
  isTrustedFolder,
  loadAgentItem,
  type AgentTarget,
} from "../lib/agentStart";
import { useUpdateProject } from "../db/hooks/useProjects";
import { useAppStore } from "../stores/app-store";
import { useOrgStore } from "../stores/org-store";
import { getLabels, notify } from "../lib/notify";
import { logError } from "../lib/log";

/** Items being started: a second click while one starts does nothing. */
const inFlight = new Set<string>();

/**
 * "Start work with agent": one click starts an Opus agent on a task, subtask or
 * project, in its project's folder (asked for and saved when none is linked),
 * then opens it on the Agents page. `enabled` is false while agents are off.
 */
export function useStartAgentOn(): { enabled: boolean; start: (target: AgentTarget) => Promise<void> } {
  const enabled = useAppStore((s) => s.agentsEnabled);
  const navigate = useNavigate();
  const updateProject = useUpdateProject();

  const start = useCallback(
    async (target: AgentTarget) => {
      const key = `${target.kind}-${target.id}`;
      if (inFlight.has(key)) return;
      inFlight.add(key);
      const t = getLabels();
      try {
        const item = await loadAgentItem(target, useOrgStore.getState().activeId);
        if (!item) return;

        let folder = item.project.folder;
        if (!folder) {
          const dir = await openDirectory({ directory: true, title: t.agents_choose_folder });
          if (typeof dir !== "string") return;
          await updateProject.mutateAsync({ id: item.project.id, data: { folder_path: dir } });
          folder = dir;
        }

        let folders: StartFolder[];
        try {
          folders = await startFolders();
        } catch (e) {
          void logError("Agents: couldn't list the start folders:", e);
          notify.error(t.agents_folders_load_failed, e);
          return;
        }
        if (!isTrustedFolder(folder, folders)) {
          if (!(await confirmTrust(folder, isHomeFolder(folder, folders)))) return;
          try {
            folder = await trustFolder(folder);
          } catch (e) {
            void logError("Agents: couldn't trust the folder:", e);
            notify.error(t.agents_trust_failed, e);
            return;
          }
        }

        let shortId: string;
        try {
          shortId = await startAgent(folder, agentPrompt(item), "opus", agentName(item));
        } catch (e) {
          void logError("Agents: start failed:", e);
          notify.error(t.agents_start_failed, e);
          return;
        }
        navigate(`/agents?started=${encodeURIComponent(shortId)}`);
      } finally {
        inFlight.delete(key);
      }
    },
    [navigate, updateProject],
  );

  return { enabled, start };
}

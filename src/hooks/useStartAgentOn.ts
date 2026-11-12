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
 * then opens it on the Agents page. `enabled` is false while agents are off. It resolves to
 * true only when the agent was started; every early stop (and a failure) is false.
 */
export function useStartAgentOn(): { enabled: boolean; start: (target: AgentTarget) => Promise<boolean> } {
  const enabled = useAppStore((s) => s.agentsEnabled);
  const navigate = useNavigate();
  const updateProject = useUpdateProject();

  const start = useCallback(
    async (target: AgentTarget) => {
      const key = `${target.kind}-${target.id}`;
      if (inFlight.has(key)) return false;
      inFlight.add(key);
      const t = getLabels();
      try {
        let item: Awaited<ReturnType<typeof loadAgentItem>>;
        let folder: string | null;
        try {
          item = await loadAgentItem(target, useOrgStore.getState().activeId);
          if (!item) return false;
          folder = item.project.folder;
          if (!folder) {
            const dir = await openDirectory({ directory: true, title: t.agents_choose_folder });
            if (typeof dir !== "string") return false;
            folder = dir;
          }
        } catch (e) {
          void logError("Agents: couldn't read the item to start on:", e);
          notify.error(t.agents_start_failed, e);
          return false;
        }
        if (!item.project.folder) {
          try {
            await updateProject.mutateAsync({ id: item.project.id, data: { folder_path: folder } });
          } catch {
            // The query client's backstop already shows "Couldn't save the project".
            return false;
          }
        }

        let folders: StartFolder[];
        try {
          folders = await startFolders();
        } catch (e) {
          void logError("Agents: couldn't list the start folders:", e);
          notify.error(t.agents_folders_load_failed, e);
          return false;
        }
        if (!isTrustedFolder(folder, folders)) {
          if (!(await confirmTrust(folder, isHomeFolder(folder, folders)))) return false;
          try {
            folder = await trustFolder(folder);
          } catch (e) {
            void logError("Agents: couldn't trust the folder:", e);
            notify.error(t.agents_trust_failed, e);
            return false;
          }
        }

        let shortId: string;
        try {
          shortId = await startAgent(folder, agentPrompt(item), "opus", agentName(item));
        } catch (e) {
          void logError("Agents: start failed:", e);
          notify.error(t.agents_start_failed, e);
          return false;
        }
        navigate(`/agents?started=${encodeURIComponent(shortId)}`);
        return true;
      } finally {
        inFlight.delete(key);
      }
    },
    [navigate, updateProject],
  );

  return { enabled, start };
}

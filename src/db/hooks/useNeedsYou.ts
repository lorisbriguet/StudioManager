import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import * as q from "../queries/needsYou";
import { setProjectAgentSettings } from "../queries/projects";
import { addDecision } from "../queries/wiki";
import type { ItemKind } from "../queries/taskAgents";
import { qk, invalidateTasks } from "../queryKeys";
import { useBriefEntries } from "./useCaptures";
import { useUpdateTask, useUpdateSubtask } from "./useTasks";

export function useOpenEntries() {
  return useQuery({ queryKey: qk.needsYou.open, queryFn: q.getOpenEntries });
}

/** What the lead and the app decided without Loris, for the last `sinceDays` days. */
export function useAloneEntries(sinceDays: number = 7) {
  return useQuery({ queryKey: qk.needsYou.aloneSince(sinceDays), queryFn: () => q.getAloneEntries(sinceDays) });
}

export function useOpenCount() {
  return useQuery({ queryKey: qk.needsYou.count, queryFn: q.countOpen });
}

/** What the Needs you tab, the sidebar and the menu bar count: open entries plus briefs. */
export function useNeedsYouCount(): number {
  const { data: open = [] } = useOpenEntries();
  const { data: briefs = [] } = useBriefEntries();
  return open.length + briefs.length;
}

/** Record what Loris decided in the project's Decisions article. */
export function useAddDecision() {
  const qc = useQueryClient();
  return useMutation({
    meta: { errorLabel: "error_save_task" },
    mutationFn: (a: { projectId: number; date: string; text: string }) => addDecision(a.projectId, a.date, a.text),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: qk.wiki.allArticles });
      qc.invalidateQueries({ queryKey: qk.wiki.allByProject });
    },
  });
}

/** `touchesTasks`: the write changes a task's or subtask's status or stage. */
function useEntryMutation<A>(fn: (arg: A) => Promise<void>, touchesTasks = false) {
  const qc = useQueryClient();
  return useMutation({
    meta: { errorLabel: "error_save_task" },
    mutationFn: fn,
    onSettled: () => {
      qc.invalidateQueries({ queryKey: qk.needsYou.all });
      if (touchesTasks) {
        qc.invalidateQueries({ queryKey: qk.taskAgents.all });
        invalidateTasks(qc);
      }
    },
  });
}

export const useAnswerEntry = () => useEntryMutation((a: { id: number; answer: string }) => q.answerEntry(a.id, a.answer));
export const useDismissEntry = () => useEntryMutation((id: number) => q.dismissEntry(id));
export const useReopenEntry = () => useEntryMutation((id: number) => q.reopenEntry(id), true);

/**
 * Send back a finished result: the item goes back to Running (the same update path Accept uses
 * to clear the stage) and the entry is answered with the note.
 */
export function useSendBack() {
  const updateTask = useUpdateTask();
  const updateSubtask = useUpdateSubtask();
  const answer = useAnswerEntry();
  return useMutation({
    meta: { errorLabel: "error_save_task" },
    mutationFn: async (a: { kind: ItemKind; id: number; entryId: number; note: string }) => {
      const data = { stage: "running" } as const;
      if (a.kind === "task") await updateTask.mutateAsync({ id: a.id, data });
      else await updateSubtask.mutateAsync({ id: a.id, data });
      await answer.mutateAsync({ id: a.entryId, answer: a.note });
    },
  });
}

export function useSetProjectAgentSettings() {
  const qc = useQueryClient();
  return useMutation({
    meta: { errorLabel: "error_save_project" },
    mutationFn: (a: { id: number; settings: Parameters<typeof setProjectAgentSettings>[1] }) =>
      setProjectAgentSettings(a.id, a.settings),
    onSettled: () => qc.invalidateQueries({ queryKey: qk.projects.all }),
  });
}

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import * as q from "../queries/needsYou";
import { setProjectAgentSettings } from "../queries/projects";
import { qk, invalidateTasks } from "../queryKeys";

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

export function useSetProjectAgentSettings() {
  const qc = useQueryClient();
  return useMutation({
    meta: { errorLabel: "error_save_project" },
    mutationFn: (a: { id: number; settings: Parameters<typeof setProjectAgentSettings>[1] }) =>
      setProjectAgentSettings(a.id, a.settings),
    onSettled: () => qc.invalidateQueries({ queryKey: qk.projects.all }),
  });
}

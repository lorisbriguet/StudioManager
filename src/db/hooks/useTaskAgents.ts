import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import * as q from "../queries/taskAgents";
import { qk, invalidateTasks } from "../queryKeys";
import { useUpdateTask, useUpdateSubtask } from "./useTasks";

export function useItemAgents(kind: q.ItemKind, id: number) {
  return useQuery({ queryKey: qk.taskAgents.byItem(kind, id), queryFn: () => q.getItemAgents(kind, id) });
}

export function useOpenLinks() {
  return useQuery({ queryKey: qk.taskAgents.open, queryFn: q.getOpenLinks });
}

export function useWasCaptured(kind: q.ItemKind, id: number) {
  return useQuery({ queryKey: qk.taskAgents.captured(kind, id), queryFn: () => q.wasCaptured(kind, id) });
}

function useStageMutation<A>(fn: (arg: A) => Promise<void>) {
  const qc = useQueryClient();
  return useMutation({
    meta: { errorLabel: "error_save_task" },
    mutationFn: fn,
    onSettled: () => {
      qc.invalidateQueries({ queryKey: qk.taskAgents.all });
      invalidateTasks(qc);
    },
  });
}

export const useSetStage = () =>
  useStageMutation((a: { kind: q.ItemKind; id: number; stage: null | "briefed" | "ready" }) => q.setStage(a.kind, a.id, a.stage));
/**
 * Accept a result: the same path as marking the item done by hand (calendar event removed, due
 * date moved to today, undo entry), with the stage cleared. Does nothing unless the item is
 * still To check at the moment of the click.
 */
export function useAcceptResult() {
  const updateTask = useUpdateTask();
  const updateSubtask = useUpdateSubtask();
  return useStageMutation(async (a: { kind: q.ItemKind; id: number }) => {
    if ((await q.getStage(a.kind, a.id)) !== "to_check") return;
    const data = { status: "done", stage: null } as const;
    if (a.kind === "task") await updateTask.mutateAsync({ id: a.id, data });
    else await updateSubtask.mutateAsync({ id: a.id, data });
  });
}

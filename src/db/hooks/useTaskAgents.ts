import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import * as q from "../queries/taskAgents";
import { qk, invalidateTasks } from "../queryKeys";

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
export const useAcceptResult = () =>
  useStageMutation((a: { kind: q.ItemKind; id: number }) => q.acceptResult(a.kind, a.id));

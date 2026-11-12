import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import * as q from "../queries/captures";
import type { CaptureStatus } from "../../types/capture";
import { qk, invalidateTasks } from "../queryKeys";

export function useCaptures(status: CaptureStatus) {
  return useQuery({ queryKey: qk.captures.byStatus(status), queryFn: () => q.getCaptures(status) });
}

export function useBriefEntries() {
  return useQuery({ queryKey: qk.captures.briefs, queryFn: q.getBriefEntries });
}

/** `touchesTasks`: the write creates a task or subtask or changes its stage or brief. */
function useCaptureMutation<A, R = void>(fn: (arg: A) => Promise<R>, touchesTasks: boolean) {
  const qc = useQueryClient();
  return useMutation({
    meta: { errorLabel: "error_capture" },
    mutationFn: fn,
    onSettled: () => {
      qc.invalidateQueries({ queryKey: qk.captures.all });
      if (touchesTasks) invalidateTasks(qc);
    },
  });
}

export const useDismissCapture = () => useCaptureMutation(q.dismissCapture, false);
export const useRestoreCapture = () => useCaptureMutation(q.restoreCapture, false);
export const useFileCaptureByHand = () => useCaptureMutation(q.fileCaptureByHand, true);
export const useKeepAsTask = () => useCaptureMutation(q.keepAsTask, true);
export const useMarkStarted = () => useCaptureMutation(q.markStarted, true);
export const useSetBrief = () =>
  useCaptureMutation((a: { kind: "task" | "subtask"; id: number; brief: string }) => q.setBrief(a.kind, a.id, a.brief), true);
export const useBriefAgain = () => useCaptureMutation(q.briefAgain, false);

import { useCallback } from "react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { useAppStore } from "../stores/app-store";
import { updateWorkloadRow } from "../db/queries/workload";
import { getTaskById } from "../db/queries/tasks";
import { useT } from "../i18n/useT";

function fmtDuration(mins: number) {
  return `${Math.floor(mins / 60)}h${String(mins % 60).padStart(2, "0")}`;
}

/**
 * Shared timer actions: stopAndSave writes elapsed time to tasks.tracked_minutes.
 *
 * When stopping a timer, the duration is added to the task's existing tracked_minutes.
 * Starting again on the same task resumes accumulation — no duplicate entries.
 */
export function useTimerActions() {
  const activeTimer = useAppStore((s) => s.activeTimer);
  const startTimer = useAppStore((s) => s.startTimer);
  const stopTimer = useAppStore((s) => s.stopTimer);
  const qc = useQueryClient();
  const t = useT();

  /** Stop active timer and save tracked_minutes to task. Returns true if saved. */
  const stopAndSave = useCallback(async (): Promise<boolean> => {
    const result = stopTimer();
    if (!result || result.durationMinutes <= 0) return false;

    // Get current tracked_minutes and add elapsed time
    const task = await getTaskById(result.taskId);
    const prev = task?.tracked_minutes ?? 0;
    const newTotal = prev + result.durationMinutes;

    await updateWorkloadRow(result.taskId, { tracked_minutes: newTotal });

    // Invalidate both workload and task queries
    qc.invalidateQueries({ queryKey: ["workload-rows", result.projectId] });
    qc.invalidateQueries({ queryKey: ["tasks"] });

    toast.success(`${t.stop_timer}: +${fmtDuration(result.durationMinutes)} → ${fmtDuration(newTotal)}`);
    return true;
  }, [stopTimer, qc, t]);

  /** Toggle timer for a task. Stops current (with save) then starts new if different task. */
  const toggleTimer = useCallback(
    async (taskId: number, projectId: number, projectName?: string) => {
      if (activeTimer?.taskId === taskId) {
        await stopAndSave();
      } else {
        if (activeTimer) await stopAndSave();
        startTimer(taskId, projectId, projectName);
        toast.success(t.start_timer);
      }
    },
    [activeTimer, stopAndSave, startTimer, t]
  );

  return { activeTimer, startTimer, stopAndSave, toggleTimer };
}

import { useCallback } from "react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { useAppStore } from "../stores/app-store";
import { getTaskById } from "../db/queries/tasks";
import { createTimeEntry } from "../db/queries/timeEntries";
import { useT } from "../i18n/useT";

function fmtDuration(mins: number) {
  return `${Math.floor(mins / 60)}h${String(mins % 60).padStart(2, "0")}`;
}

/**
 * Shared timer actions: stopAndSave creates a time_entry and updates tasks.tracked_minutes.
 *
 * When stopping a timer, a new time_entry is created with the elapsed duration.
 * The task's tracked_minutes is also incremented via createTimeEntry.
 */
export function useTimerActions() {
  const activeTimer = useAppStore((s) => s.activeTimer);
  const startTimer = useAppStore((s) => s.startTimer);
  const stopTimer = useAppStore((s) => s.stopTimer);
  const qc = useQueryClient();
  const t = useT();

  /** Stop active timer, create time entry, and update tracked_minutes. Returns true if saved. */
  const stopAndSave = useCallback(async (): Promise<boolean> => {
    const result = stopTimer();
    if (!result || result.durationMinutes <= 0) return false;

    const today = new Date().toISOString().slice(0, 10);

    // Create time entry (also updates task.tracked_minutes via createTimeEntry)
    await createTimeEntry({
      task_id: result.taskId,
      project_id: result.projectId,
      duration_minutes: result.durationMinutes,
      date: today,
    });

    // Get the new total for the toast
    const task = await getTaskById(result.taskId);
    const newTotal = task?.tracked_minutes ?? result.durationMinutes;

    // Invalidate workload, task, and time-entries queries
    qc.invalidateQueries({ queryKey: ["workload-rows", result.projectId] });
    qc.invalidateQueries({ queryKey: ["tasks"] });
    qc.invalidateQueries({ queryKey: ["time-entries"] });
    qc.invalidateQueries({ queryKey: ["time-this-week"] });
    qc.invalidateQueries({ queryKey: ["weekly-trend"] });
    qc.invalidateQueries({ queryKey: ["top-time-consumers"] });
    qc.invalidateQueries({ queryKey: ["project-time-distribution"] });

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

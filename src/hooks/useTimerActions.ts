import { useCallback } from "react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { useAppStore } from "../stores/app-store";
import { getTaskById } from "../db/queries/tasks";
import { getProject } from "../db/queries/projects";
import { createTimeEntry } from "../db/queries/timeEntries";
import { notifyError } from "../lib/notifyError";
import { todayLocalISO } from "../utils/localDate";
import { useT } from "../i18n/useT";

function fmtDuration(mins: number) {
  return `${Math.floor(mins / 60)}h${String(mins % 60).padStart(2, "0")}`;
}

/**
 * Shared timer actions: stopAndSave creates a time_entry and updates tasks.tracked_minutes.
 *
 * The active timer is persisted to localStorage (see app-store) so it survives
 * app restarts; elapsed time is always derived from startedAt.
 *
 * stopAndSave writes the time entry FIRST and only clears the timer state on
 * success — if the DB write fails the timer keeps running so no time is lost.
 * It never rejects; failures are surfaced via notifyError.
 */
export function useTimerActions() {
  const activeTimer = useAppStore((s) => s.activeTimer);
  const startTimer = useAppStore((s) => s.startTimer);
  const clearTimer = useAppStore((s) => s.clearTimer);
  const qc = useQueryClient();
  const t = useT();

  /** Stop active timer, create time entry, and update tracked_minutes. Returns true if saved. */
  const stopAndSave = useCallback(async (): Promise<boolean> => {
    // Read from the store directly to avoid acting on a stale snapshot.
    const timer = useAppStore.getState().activeTimer;
    if (!timer) return false;
    const durationMinutes = Math.max(1, Math.round((Date.now() - timer.startedAt) / 60000));
    const today = todayLocalISO();

    let taskExists: boolean;
    try {
      // The task (or project) may have been deleted while the timer ran —
      // e.g. a timer restored after an app restart.
      taskExists = (await getTaskById(timer.taskId)) !== null;
      if (!taskExists && (await getProject(timer.projectId)) === null) {
        // Nothing left to attach the entry to (project_id is NOT NULL).
        // Surface the loss and discard the timer instead of leaving it
        // running against a target that can never be saved.
        clearTimer();
        notifyError(
          t.time_entry_project_deleted,
          new Error(`project ${timer.projectId} deleted while timer was running`)
        );
        return false;
      }
      // Create the time entry (also updates task.tracked_minutes).
      // task_id is nullable (ON DELETE SET NULL): if the task is gone, keep
      // the time on the project instead of losing it.
      await createTimeEntry({
        task_id: taskExists ? timer.taskId : null,
        project_id: timer.projectId,
        duration_minutes: durationMinutes,
        date: today,
      });
    } catch (err) {
      // Keep the timer running — clearing it here would lose the tracked time.
      notifyError(t.time_entry_save_failed, err);
      return false;
    }

    // Entry is safely in the DB — now the timer state can go.
    clearTimer();

    // Get the new total for the toast (non-critical; fall back to the entry's duration)
    let newTotal = durationMinutes;
    if (taskExists) {
      try {
        const task = await getTaskById(timer.taskId);
        newTotal = task?.tracked_minutes ?? durationMinutes;
      } catch {
        // Entry already saved; the toast just shows the session duration.
      }
    }

    // Invalidate workload, task, and time-entries queries
    qc.invalidateQueries({ queryKey: ["workload-rows", timer.projectId] });
    qc.invalidateQueries({ queryKey: ["tasks"] });
    qc.invalidateQueries({ queryKey: ["time-entries"] });
    qc.invalidateQueries({ queryKey: ["time-this-week"] });
    qc.invalidateQueries({ queryKey: ["weekly-trend"] });
    qc.invalidateQueries({ queryKey: ["top-time-consumers"] });
    qc.invalidateQueries({ queryKey: ["project-time-distribution"] });

    toast.success(`${t.stop_timer}: +${fmtDuration(durationMinutes)} → ${fmtDuration(newTotal)}`);
    return true;
  }, [clearTimer, qc, t]);

  /** Toggle timer for a task. Stops current (with save) then starts new if different task. Never rejects. */
  const toggleTimer = useCallback(
    async (taskId: number, projectId: number, projectName?: string) => {
      // Read from the store directly to avoid acting on a stale snapshot.
      const current = useAppStore.getState().activeTimer;
      if (current?.taskId === taskId) {
        await stopAndSave();
      } else {
        if (current) {
          await stopAndSave();
          // If saving failed the old timer is still running — don't overwrite
          // it, that would silently lose the unsaved time. stopAndSave has
          // already surfaced the error.
          if (useAppStore.getState().activeTimer) return;
        }
        startTimer(taskId, projectId, projectName);
        toast.success(t.start_timer);
      }
    },
    [stopAndSave, startTimer, t]
  );

  return { activeTimer, startTimer, stopAndSave, toggleTimer };
}

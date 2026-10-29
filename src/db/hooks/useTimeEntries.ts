import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import * as q from "../queries/timeEntries";
import { snapshotRows, pushRestore } from "../undoRestore";
import { getLabels } from "../../lib/notify";

export function useDeleteTimeEntry() {
  const qc = useQueryClient();
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["time-entries"] });
    qc.invalidateQueries({ queryKey: ["tasks"] });
    qc.invalidateQueries({ queryKey: ["time-this-week"] });
    qc.invalidateQueries({ queryKey: ["weekly-trend"] });
    qc.invalidateQueries({ queryKey: ["top-time-consumers"] });
    qc.invalidateQueries({ queryKey: ["project-time-distribution"] });
    qc.invalidateQueries({ queryKey: ["workload-rows"] });
  };
  return useMutation({
    meta: { errorLabel: "error_delete_time_entry" },
    mutationFn: async (id: number) => {
      const snap = await snapshotRows([{ table: "time_entries", where: "id = $1", params: [id] }]);
      await q.deleteTimeEntry(id);
      const entry = snap[0].rows[0] as { task_id?: number | null; duration_minutes?: number } | undefined;
      // The delete took the minutes off the task; the restore gives them back.
      const extra = entry?.task_id
        ? [{ sql: "UPDATE tasks SET tracked_minutes = tracked_minutes + $1, updated_at = datetime('now') WHERE id = $2", params: [entry.duration_minutes ?? 0, entry.task_id] }]
        : [];
      pushRestore(getLabels().undo_delete_time_entry, snap, { redo: () => q.deleteTimeEntry(id), invalidate, extra });
    },
    onSuccess: invalidate,
  });
}

export function useTimeEntriesWithDetails(startDate?: string, endDate?: string, projectId?: number) {
  return useQuery({
    queryKey: ["time-entries", "details", startDate, endDate, projectId],
    queryFn: () => q.getTimeEntriesWithDetails(startDate, endDate, projectId),
  });
}

export function useUpdateTimeEntry() {
  const qc = useQueryClient();
  return useMutation({
    meta: { errorLabel: "error_save_time_entry" },
    mutationFn: (args: { id: number; data: { date?: string; duration_minutes?: number; description?: string } }) =>
      q.updateTimeEntry(args.id, args.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["time-entries"] });
      qc.invalidateQueries({ queryKey: ["tasks"] });
      qc.invalidateQueries({ queryKey: ["time-this-week"] });
      qc.invalidateQueries({ queryKey: ["weekly-trend"] });
    },
  });
}

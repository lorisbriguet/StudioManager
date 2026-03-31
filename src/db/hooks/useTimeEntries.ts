import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import * as q from "../queries/timeEntries";

export function useTimeEntries(projectId?: number) {
  return useQuery({
    queryKey: projectId !== undefined
      ? ["time-entries", "project", projectId]
      : ["time-entries"],
    queryFn: () => q.getTimeEntries(projectId),
  });
}

export function useTimeEntriesByTask(taskId: number) {
  return useQuery({
    queryKey: ["time-entries", "task", taskId],
    queryFn: () => q.getTimeEntriesByTask(taskId),
    enabled: !!taskId,
  });
}

export function useCreateTimeEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: {
      task_id: number;
      project_id: number;
      duration_minutes: number;
      date: string;
      description?: string;
    }) => q.createTimeEntry(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["time-entries"] });
      qc.invalidateQueries({ queryKey: ["tasks"] });
      qc.invalidateQueries({ queryKey: ["time-this-week"] });
      qc.invalidateQueries({ queryKey: ["weekly-trend"] });
      qc.invalidateQueries({ queryKey: ["top-time-consumers"] });
      qc.invalidateQueries({ queryKey: ["project-time-distribution"] });
      qc.invalidateQueries({ queryKey: ["workload-rows"] });
    },
    onError: (e) => {
      toast.error(String(e));
    },
  });
}

export function useDeleteTimeEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => q.deleteTimeEntry(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["time-entries"] });
      qc.invalidateQueries({ queryKey: ["tasks"] });
      qc.invalidateQueries({ queryKey: ["time-this-week"] });
      qc.invalidateQueries({ queryKey: ["weekly-trend"] });
      qc.invalidateQueries({ queryKey: ["top-time-consumers"] });
      qc.invalidateQueries({ queryKey: ["project-time-distribution"] });
      qc.invalidateQueries({ queryKey: ["workload-rows"] });
    },
    onError: (e) => {
      toast.error(String(e));
    },
  });
}

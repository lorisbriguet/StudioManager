import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import * as q from "../queries/timeEntries";

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

export function useTimeEntriesWithDetails(startDate?: string, endDate?: string, projectId?: number) {
  return useQuery({
    queryKey: ["time-entries", "details", startDate, endDate, projectId],
    queryFn: () => q.getTimeEntriesWithDetails(startDate, endDate, projectId),
  });
}

export function useUpdateTimeEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { id: number; data: { date?: string; duration_minutes?: number; description?: string } }) =>
      q.updateTimeEntry(args.id, args.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["time-entries"] });
      qc.invalidateQueries({ queryKey: ["tasks"] });
      qc.invalidateQueries({ queryKey: ["time-this-week"] });
      qc.invalidateQueries({ queryKey: ["weekly-trend"] });
    },
    onError: (e) => toast.error(String(e)),
  });
}

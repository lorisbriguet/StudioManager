import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as q from "../queries/activities";
import { snapshotRows, pushRestore } from "../undoRestore";
import { getLabels } from "../../lib/notify";

export function useActivities() {
  return useQuery({ queryKey: ["activities"], queryFn: q.getActivities });
}

export function useCreateActivity() {
  const qc = useQueryClient();
  return useMutation({
    meta: { errorLabel: "error_save_activity" },
    mutationFn: ({ name_fr, name_en }: { name_fr: string; name_en: string }) =>
      q.createActivity(name_fr, name_en),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["activities"] }),
  });
}

export function useUpdateActivity() {
  const qc = useQueryClient();
  return useMutation({
    meta: { errorLabel: "error_save_activity" },
    mutationFn: ({ id, name_fr, name_en }: { id: number; name_fr: string; name_en: string }) =>
      q.updateActivity(id, { name_fr, name_en }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["activities"] }),
  });
}

export function useDeleteActivity() {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ["activities"] });
  return useMutation({
    meta: { errorLabel: "error_delete_activity" },
    mutationFn: async (id: number) => {
      const snap = await snapshotRows([{ table: "activities", where: "id = $1", params: [id] }]);
      await q.deleteActivity(id);
      pushRestore(getLabels().undo_delete_activity, snap, { redo: () => q.deleteActivity(id), invalidate });
    },
    onSuccess: invalidate,
  });
}

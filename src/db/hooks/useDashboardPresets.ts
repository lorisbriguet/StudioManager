import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getDashboardPresets,
  createDashboardPreset,
  updateDashboardPreset,
  deleteDashboardPreset,
} from "../queries/dashboardPresets";
import { snapshotRows, pushRestore } from "../undoRestore";
import { getLabels } from "../../lib/notifyError";

export function useDashboardPresets() {
  return useQuery({
    queryKey: ["dashboard-presets"],
    queryFn: getDashboardPresets,
  });
}

export function useCreateDashboardPreset() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ name, layoutJson }: { name: string; layoutJson: string }) =>
      createDashboardPreset(name, layoutJson),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["dashboard-presets"] }),
  });
}

export function useUpdateDashboardPreset() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: { name?: string; layout_json?: string } }) =>
      updateDashboardPreset(id, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["dashboard-presets"] }),
  });
}

export function useDeleteDashboardPreset() {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ["dashboard-presets"] });
  return useMutation({
    mutationFn: async (id: number) => {
      // Built-in presets are never deleted, so never restored either.
      const snap = await snapshotRows([{ table: "dashboard_presets", where: "id = $1 AND is_builtin = 0", params: [id] }]);
      await deleteDashboardPreset(id);
      const name = String(snap[0].rows[0]?.name ?? "");
      pushRestore(`${getLabels().undo_delete_preset} "${name}"`, snap, { redo: () => deleteDashboardPreset(id), invalidate });
    },
    onSuccess: invalidate,
  });
}

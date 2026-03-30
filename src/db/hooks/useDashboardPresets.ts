import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getDashboardPresets,
  createDashboardPreset,
  updateDashboardPreset,
  deleteDashboardPreset,
} from "../queries/dashboardPresets";

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
  return useMutation({
    mutationFn: (id: number) => deleteDashboardPreset(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["dashboard-presets"] }),
  });
}

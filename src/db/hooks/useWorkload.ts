import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import * as q from "../queries/workload";
import type { WorkloadColumn } from "../../types/workload";
import { useUndoStore } from "../../stores/undo-store";

// ── Templates ──────────────────────────────────────────────

export function useWorkloadTemplates() {
  return useQuery({
    queryKey: ["workload-templates"],
    queryFn: q.getWorkloadTemplates,
  });
}

export function useWorkloadTemplate(id: number | null) {
  return useQuery({
    queryKey: ["workload-templates", id],
    queryFn: () => (id ? q.getWorkloadTemplate(id) : null),
    enabled: id !== null,
  });
}

export function useCreateWorkloadTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { name: string; columns: WorkloadColumn[] }) =>
      q.createWorkloadTemplate(data.name, data.columns),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["workload-templates"] }),
  });
}

export function useUpdateWorkloadTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: {
      id: number;
      name?: string;
      columns?: WorkloadColumn[];
    }) => q.updateWorkloadTemplate(data.id, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["workload-templates"] }),
  });
}

export function useDeleteWorkloadTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => q.deleteWorkloadTemplate(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["workload-templates"] }),
  });
}

// ── Rows (backed by tasks) ────────────────────────────────

export function useWorkloadRows(projectId: number) {
  return useQuery({
    queryKey: ["workload-rows", projectId],
    queryFn: () => q.getWorkloadRows(projectId),
  });
}

export function useCreateWorkloadRow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: {
      project_id: number;
      title?: string;
      cells: Record<string, unknown>;
      sort_order: number;
    }) => {
      const id = await q.createWorkloadRow(data);
      useUndoStore.getState().push({
        label: "Create workload row",
        execute: async () => {
          await q.deleteWorkloadRow(id);
          qc.invalidateQueries({ queryKey: ["workload-rows", data.project_id] });
          qc.invalidateQueries({ queryKey: ["tasks"] });
        },
      });
      return id;
    },
    onSuccess: (_id, vars) => {
      qc.invalidateQueries({ queryKey: ["workload-rows", vars.project_id] });
      qc.invalidateQueries({ queryKey: ["tasks"] });
    },
  });
}

export function useUpdateWorkloadRow(projectId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: {
      id: number;
      title?: string;
      cells?: Record<string, unknown>;
      sort_order?: number;
      tracked_minutes?: number;
      planned_minutes?: number | null;
    }) => {
      const prev = await q.getWorkloadRow(data.id);
      await q.updateWorkloadRow(data.id, data);
      if (prev) {
        const prevUpdate: Record<string, unknown> = {};
        if (data.cells !== undefined) prevUpdate.cells = prev.cells;
        if (data.title !== undefined) prevUpdate.title = prev.title;
        if (data.sort_order !== undefined) prevUpdate.sort_order = prev.sort_order;
        if (data.tracked_minutes !== undefined) prevUpdate.tracked_minutes = prev.tracked_minutes;
        if (data.planned_minutes !== undefined) prevUpdate.planned_minutes = prev.planned_minutes;
        useUndoStore.getState().push({
          label: "Edit workload cell",
          execute: async () => {
            await q.updateWorkloadRow(data.id, prevUpdate as {
              title?: string;
              cells?: Record<string, unknown>;
              sort_order?: number;
              tracked_minutes?: number;
              planned_minutes?: number | null;
            });
            qc.invalidateQueries({ queryKey: ["workload-rows", projectId] });
            qc.invalidateQueries({ queryKey: ["tasks"] });
          },
        });
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["workload-rows", projectId] });
      qc.invalidateQueries({ queryKey: ["tasks"] });
    },
  });
}

export function useReorderWorkloadRows(projectId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (orderedIds: number[]) => q.reorderWorkloadRows(orderedIds),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["workload-rows", projectId] }),
  });
}

export function useDeleteWorkloadRow(projectId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      const prev = await q.getWorkloadRow(id);
      await q.deleteWorkloadRow(id);
      if (prev) {
        useUndoStore.getState().push({
          label: "Delete workload row",
          execute: async () => {
            await q.createWorkloadRow({
              project_id: prev.project_id,
              title: prev.title,
              cells: prev.cells,
              sort_order: prev.sort_order,
            });
            qc.invalidateQueries({ queryKey: ["workload-rows", projectId] });
            qc.invalidateQueries({ queryKey: ["tasks"] });
          },
        });
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["workload-rows", projectId] });
      qc.invalidateQueries({ queryKey: ["tasks"] });
    },
  });
}

// ── Project config ─────────────────────────────────────────

export function useProjectWorkloadConfig(projectId: number) {
  return useQuery({
    queryKey: ["workload-config", projectId],
    queryFn: () => q.getProjectWorkloadConfig(projectId),
  });
}

export function useSetProjectWorkloadConfig(projectId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: {
      templateId: number | null;
      columns: WorkloadColumn[];
    }) => {
      const prev = await q.getProjectWorkloadConfig(projectId);
      await q.setProjectWorkloadConfig(projectId, data.templateId, data.columns);
      useUndoStore.getState().push({
        label: "Change workload columns",
        execute: async () => {
          await q.setProjectWorkloadConfig(
            projectId,
            prev.template_id,
            prev.columns ?? []
          );
          qc.invalidateQueries({ queryKey: ["workload-config", projectId] });
        },
      });
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["workload-config", projectId] }),
  });
}

// ── All project workload configs (for calendar colors) ─────

export function useAllProjectWorkloadConfigs() {
  return useQuery({
    queryKey: ["workload-configs-all"],
    queryFn: q.getAllProjectWorkloadConfigs,
  });
}

// ── Time Overview (read-only aggregate) ────────────────────

export function useTimeOverviewData() {
  return useQuery({
    queryKey: ["time-overview"],
    queryFn: q.getTimeOverviewData,
  });
}

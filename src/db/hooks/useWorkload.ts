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

// ── Rows ───────────────────────────────────────────────────

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
      template_id: number | null;
      task_id: number | null;
      cells: Record<string, unknown>;
      sort_order: number;
    }) => {
      const id = await q.createWorkloadRow(data);
      useUndoStore.getState().push({
        label: "Create workload row",
        execute: async () => {
          await q.deleteWorkloadRow(id);
          qc.invalidateQueries({ queryKey: ["workload-rows", data.project_id] });
        },
      });
      return id;
    },
    onSuccess: (_id, vars) =>
      qc.invalidateQueries({
        queryKey: ["workload-rows", vars.project_id],
      }),
  });
}

export function useUpdateWorkloadRow(projectId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: {
      id: number;
      task_id?: number | null;
      cells?: Record<string, unknown>;
      sort_order?: number;
    }) => {
      const prev = await q.getWorkloadRow(data.id);
      await q.updateWorkloadRow(data.id, data);
      if (prev) {
        const prevUpdate: Record<string, unknown> = {};
        if (data.cells !== undefined) prevUpdate.cells = prev.cells;
        if (data.task_id !== undefined) prevUpdate.task_id = prev.task_id;
        if (data.sort_order !== undefined) prevUpdate.sort_order = prev.sort_order;
        useUndoStore.getState().push({
          label: "Edit workload cell",
          execute: async () => {
            await q.updateWorkloadRow(data.id, prevUpdate as {
              task_id?: number | null;
              cells?: Record<string, unknown>;
              sort_order?: number;
            });
            qc.invalidateQueries({ queryKey: ["workload-rows", projectId] });
          },
        });
      }
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["workload-rows", projectId] }),
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
              template_id: prev.template_id,
              task_id: prev.task_id,
              cells: prev.cells,
              sort_order: prev.sort_order,
            });
            qc.invalidateQueries({ queryKey: ["workload-rows", projectId] });
          },
        });
      }
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["workload-rows", projectId] }),
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

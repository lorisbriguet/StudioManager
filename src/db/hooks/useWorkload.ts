import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import * as q from "../queries/workload";
import type { WorkloadColumn } from "../../types/workload";
import { useUndoStore } from "../../stores/undo-store";
import { getLabels } from "../../lib/notify";
import { snapshotRows, snapshotLinks, pushRestore, reinsertAt } from "../undoRestore";

// ── Templates ──────────────────────────────────────────────

export function useWorkloadTemplates() {
  return useQuery({
    queryKey: ["workload-templates"],
    queryFn: q.getWorkloadTemplates,
  });
}

export function useCreateWorkloadTemplate() {
  const qc = useQueryClient();
  return useMutation({
    meta: { errorLabel: "error_save_template" },
    mutationFn: (data: { name: string; columns: WorkloadColumn[] }) =>
      q.createWorkloadTemplate(data.name, data.columns),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["workload-templates"] }),
  });
}

export function useUpdateWorkloadTemplate() {
  const qc = useQueryClient();
  return useMutation({
    meta: { errorLabel: "error_save_template" },
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
  const invalidate = () => qc.invalidateQueries({ queryKey: ["workload-templates"] });
  return useMutation({
    meta: { errorLabel: "error_delete_template" },
    // Undo puts the very same row back: projects.workload_template_id (no
    // foreign key, so the delete leaves it as is) points at a template again.
    mutationFn: async (id: number) => {
      const snap = await snapshotRows([{ table: "workload_templates", where: "id = $1", params: [id] }]);
      // Legacy workload_rows.template_id is ON DELETE SET NULL.
      const links = await snapshotLinks([{ table: "workload_rows", column: "template_id", id }]);
      await q.deleteWorkloadTemplate(id);
      const name = String(snap[0].rows[0]?.name ?? "");
      pushRestore(`${getLabels().undo_delete_workload_template} "${name}"`, snap, {
        redo: () => q.deleteWorkloadTemplate(id),
        invalidate,
        extra: links,
      });
    },
    onSuccess: invalidate,
  });
}

/**
 * Remove a template's column. Undo and redo work on the columns as they are
 * when they run, so a column added or edited since stays.
 */
export function useDeleteWorkloadTemplateColumn() {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ["workload-templates"] });
  const setColumns = async (templateId: number, change: (cols: WorkloadColumn[]) => WorkloadColumn[]) => {
    const tpl = await q.getWorkloadTemplate(templateId);
    if (!tpl) return;
    await q.updateWorkloadTemplate(templateId, { columns: change(tpl.columns) });
    invalidate();
  };
  return useMutation({
    meta: { errorLabel: "error_save_template" },
    mutationFn: async ({ templateId, key }: { templateId: number; key: string }) => {
      const tpl = await q.getWorkloadTemplate(templateId);
      const index = tpl?.columns.findIndex((c) => c.key === key) ?? -1;
      if (!tpl || index === -1) return;
      const col = tpl.columns[index];
      const without = (cols: WorkloadColumn[]) => cols.filter((c) => c.key !== key);
      await q.updateWorkloadTemplate(templateId, { columns: without(tpl.columns) });
      useUndoStore.getState().push({
        label: getLabels().undo_delete_column,
        execute: () => setColumns(templateId, (cols) => reinsertAt(cols, col, index, (c) => c.key === key)),
        redo: () => setColumns(templateId, without),
      });
    },
    onSuccess: invalidate,
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
    meta: { errorLabel: "error_save_row" },
    mutationFn: async (data: {
      project_id: number;
      title?: string;
      cells: Record<string, unknown>;
      sort_order: number;
    }) => {
      const id = await q.createWorkloadRow(data);
      useUndoStore.getState().push({
        label: getLabels().undo_create_workload_row,
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
    meta: { errorLabel: "error_save_row" },
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
          label: getLabels().undo_edit_workload_cell,
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
    meta: { errorLabel: "error_save_row" },
    mutationFn: (orderedIds: number[]) => q.reorderWorkloadRows(orderedIds),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["workload-rows", projectId] }),
  });
}

export function useDeleteWorkloadRow(projectId: number) {
  const qc = useQueryClient();
  return useMutation({
    meta: { errorLabel: "error_delete_row" },
    mutationFn: async (id: number) => {
      const prev = await q.getWorkloadRow(id);
      await q.deleteWorkloadRow(id);
      if (prev) {
        useUndoStore.getState().push({
          label: getLabels().undo_delete_workload_row,
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
    meta: { errorLabel: "error_save_workload" },
    mutationFn: async (data: {
      templateId: number | null;
      columns: WorkloadColumn[];
    }) => {
      const prev = await q.getProjectWorkloadConfig(projectId);
      await q.setProjectWorkloadConfig(projectId, data.templateId, data.columns);
      useUndoStore.getState().push({
        label: getLabels().undo_change_workload_columns,
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

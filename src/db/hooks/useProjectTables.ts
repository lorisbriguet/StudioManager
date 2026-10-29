import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import * as q from "../queries/projectTables";
import { useUndoStore } from "../../stores/undo-store";
import type { TableColumnDef, ProjectTableRow } from "../../types/project-table";
import { getLabels } from "../../lib/notify";
import { snapshotRows, pushRestore, reinsertAt } from "../undoRestore";

export function useProjectTables(projectId: number) {
  return useQuery({
    queryKey: ["project-tables", projectId],
    queryFn: () => q.getProjectTables(projectId),
    enabled: projectId > 0,
  });
}

export function useCreateProjectTable(projectId: number) {
  const qc = useQueryClient();
  return useMutation({
    meta: { errorLabel: "error_save_table" },
    mutationFn: ({ name, columns }: { name: string; columns?: TableColumnDef[] }) =>
      q.createProjectTable(projectId, name, columns),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["project-tables", projectId] }),
  });
}

export function useUpdateProjectTable(projectId: number) {
  const qc = useQueryClient();
  return useMutation({
    meta: { errorLabel: "error_save_table" },
    mutationFn: ({ id, data }: { id: number; data: { name?: string; column_config?: TableColumnDef[] } }) =>
      q.updateProjectTable(id, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["project-tables", projectId] }),
  });
}

export function useDeleteProjectTable(projectId: number) {
  const qc = useQueryClient();
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["project-tables", projectId] });
    qc.invalidateQueries({ queryKey: ["project-table-rows"] });
  };
  return useMutation({
    meta: { errorLabel: "error_delete_table" },
    // Undo puts the very same rows back (ids, sort_order, dates); redo deletes that id.
    mutationFn: async (id: number) => {
      const snap = await snapshotRows([
        { table: "project_tables", where: "id = $1", params: [id] },
        { table: "project_table_rows", where: "table_id = $1", params: [id] },
      ]);
      await q.deleteProjectTable(id);
      const name = String(snap[0].rows[0]?.name ?? "");
      pushRestore(`${getLabels().undo_delete_table} "${name}"`, snap, { redo: () => q.deleteProjectTable(id), invalidate });
    },
    onSuccess: invalidate,
  });
}

/**
 * Remove a column (the rows keep its values). Undo and redo work on the
 * columns as they are when they run, so a column added or edited since stays.
 */
export function useDeleteProjectTableColumn(projectId: number) {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ["project-tables", projectId] });
  const setColumns = async (tableId: number, change: (cols: TableColumnDef[]) => TableColumnDef[]) => {
    const table = await q.getProjectTable(tableId);
    if (!table) return;
    await q.updateProjectTable(tableId, { column_config: change(table.column_config) });
    invalidate();
  };
  return useMutation({
    meta: { errorLabel: "error_save_table" },
    mutationFn: async ({ tableId, colId }: { tableId: number; colId: string }) => {
      const table = await q.getProjectTable(tableId);
      const index = table?.column_config.findIndex((c) => c.id === colId) ?? -1;
      if (!table || index === -1) return;
      const col = table.column_config[index];
      const without = (cols: TableColumnDef[]) => cols.filter((c) => c.id !== colId);
      await q.updateProjectTable(tableId, { column_config: without(table.column_config) });
      useUndoStore.getState().push({
        label: getLabels().undo_delete_column,
        execute: () => setColumns(tableId, (cols) => reinsertAt(cols, col, index, (c) => c.id === colId)),
        redo: () => setColumns(tableId, without),
      });
    },
    onSuccess: invalidate,
  });
}

// ── Rows ──────────────────────────────────────────

export function useProjectTableRows(tableId: number) {
  return useQuery({
    queryKey: ["project-table-rows", tableId],
    queryFn: () => q.getProjectTableRows(tableId),
    enabled: tableId > 0,
  });
}

export function useCreateProjectTableRow(tableId: number) {
  const qc = useQueryClient();
  return useMutation({
    meta: { errorLabel: "error_save_row" },
    mutationFn: (data?: Record<string, unknown>) => q.createProjectTableRow(tableId, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["project-table-rows", tableId] }),
  });
}

export function useUpdateProjectTableRow(tableId: number) {
  const qc = useQueryClient();
  return useMutation({
    meta: { errorLabel: "error_save_row" },
    mutationFn: ({ id, data }: { id: number; data: Record<string, unknown> }) =>
      q.updateProjectTableRow(id, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["project-table-rows", tableId] }),
  });
}

export function useDeleteProjectTableRow(tableId: number) {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ["project-table-rows", tableId] });
  return useMutation({
    meta: { errorLabel: "error_delete_row" },
    mutationFn: async (id: number) => {
      const snap = await snapshotRows([{ table: "project_table_rows", where: "id = $1", params: [id] }]);
      await q.deleteProjectTableRow(id);
      pushRestore(getLabels().undo_delete_row, snap, { redo: () => q.deleteProjectTableRow(id), invalidate });
    },
    onSuccess: invalidate,
  });
}

/** Drag-and-drop order of a table's rows; the list moves at once, the write follows. */
export function useReorderProjectTableRows(tableId: number) {
  const qc = useQueryClient();
  const key = ["project-table-rows", tableId];
  return useMutation({
    meta: { errorLabel: "error_save_row" },
    mutationFn: (ids: number[]) => q.reorderProjectTableRows(ids),
    onMutate: async (ids: number[]) => {
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<ProjectTableRow[]>(key);
      if (prev) {
        const byId = new Map(prev.map((r) => [r.id, r]));
        qc.setQueryData(key, ids.flatMap((id, i) => (byId.has(id) ? [{ ...byId.get(id)!, sort_order: i }] : [])));
      }
      return { prev };
    },
    onError: (_e, _ids, ctx) => {
      if (ctx?.prev) qc.setQueryData(key, ctx.prev);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: key }),
  });
}

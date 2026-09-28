import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import * as q from "../queries/projectTables";
import { useUndoStore } from "../../stores/undo-store";
import type { TableColumnDef } from "../../types/project-table";
import { getLabels } from "../../lib/notifyError";

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
    mutationFn: ({ name, columns }: { name: string; columns?: TableColumnDef[] }) =>
      q.createProjectTable(projectId, name, columns),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["project-tables", projectId] }),
  });
}

export function useUpdateProjectTable(projectId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: { name?: string; column_config?: TableColumnDef[] } }) =>
      q.updateProjectTable(id, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["project-tables", projectId] }),
  });
}

export function useDeleteProjectTable(projectId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      // Snapshot table + rows before deleting for undo
      const tables = await q.getProjectTables(projectId);
      const table = tables.find((t) => t.id === id);
      const rows = await q.getProjectTableRows(id);
      await q.deleteProjectTable(id);
      if (table) {
        // The restore assigns a fresh rowid; redo targets exactly that id —
        // a name lookup could hit a different row with the same name.
        let restoredId: number | null = null;
        useUndoStore.getState().push({
          label: `${getLabels().undo_delete_table} "${table.name}"`,
          execute: async () => {
            restoredId = await q.createProjectTable(projectId, table.name, table.column_config);
            for (const row of rows) {
              await q.createProjectTableRow(restoredId, row.data);
            }
            qc.invalidateQueries({ queryKey: ["project-tables", projectId] });
          },
          redo: async () => {
            if (restoredId !== null) await q.deleteProjectTable(restoredId);
            qc.invalidateQueries({ queryKey: ["project-tables", projectId] });
          },
        });
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["project-tables", projectId] }),
    onError: (e) => { toast.error(String(e)); },
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
    mutationFn: (data?: Record<string, unknown>) => q.createProjectTableRow(tableId, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["project-table-rows", tableId] }),
  });
}

export function useUpdateProjectTableRow(tableId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: Record<string, unknown> }) =>
      q.updateProjectTableRow(id, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["project-table-rows", tableId] }),
  });
}

export function useDeleteProjectTableRow(tableId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => q.deleteProjectTableRow(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["project-table-rows", tableId] }),
  });
}

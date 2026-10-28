import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getSavedFilters,
  createSavedFilter,
  renameSavedFilter,
  updateSavedFilterData,
  deleteSavedFilter,
} from "../queries/savedFilters";
import { snapshotRows, pushRestore } from "../undoRestore";
import { getLabels } from "../../lib/notifyError";
import type { SavedFilterData } from "../../types/saved-filter";

export function useSavedFilters(page: string) {
  return useQuery({
    queryKey: ["saved-filters", page],
    queryFn: () => getSavedFilters(page),
  });
}

export function useCreateSavedFilter(page: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ name, filters }: { name: string; filters: SavedFilterData }) =>
      createSavedFilter(page, name, filters as Record<string, unknown>),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["saved-filters", page] }),
  });
}

export function useRenameSavedFilter(page: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, name }: { id: number; name: string }) => renameSavedFilter(id, name),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["saved-filters", page] }),
  });
}

export function useUpdateSavedFilter(page: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, filters }: { id: number; filters: SavedFilterData }) =>
      updateSavedFilterData(id, filters as Record<string, unknown>),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["saved-filters", page] }),
  });
}

export function useDeleteSavedFilter(page: string) {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ["saved-filters", page] });
  return useMutation({
    mutationFn: async (id: number) => {
      const snap = await snapshotRows([{ table: "saved_filters", where: "id = $1", params: [id] }]);
      await deleteSavedFilter(id);
      const name = String(snap[0].rows[0]?.name ?? "");
      pushRestore(`${getLabels().undo_delete_filter} "${name}"`, snap, { redo: () => deleteSavedFilter(id), invalidate });
    },
    onSuccess: invalidate,
  });
}

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getSavedFilters,
  createSavedFilter,
  renameSavedFilter,
  deleteSavedFilter,
} from "../queries/savedFilters";

export function useSavedFilters(page: string) {
  return useQuery({
    queryKey: ["saved-filters", page],
    queryFn: () => getSavedFilters(page),
  });
}

export function useCreateSavedFilter(page: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ name, filters }: { name: string; filters: Record<string, unknown> }) =>
      createSavedFilter(page, name, filters),
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

export function useDeleteSavedFilter(page: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => deleteSavedFilter(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["saved-filters", page] }),
  });
}

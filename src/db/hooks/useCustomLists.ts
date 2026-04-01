import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import * as q from "../queries/customLists";

export function useCustomLists() {
  return useQuery({
    queryKey: ["custom-lists"],
    queryFn: q.getCustomLists,
  });
}

export function useCustomListItems(listId: number | null) {
  return useQuery({
    queryKey: ["custom-list-items", listId],
    queryFn: () => q.getCustomListItems(listId!),
    enabled: listId !== null,
  });
}

export function useCreateCustomList() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => q.createCustomList(name),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["custom-lists"] }),
    onError: (e) => { toast.error(String(e)); },
  });
}

export function useUpdateCustomList() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, name }: { id: number; name: string }) =>
      q.updateCustomList(id, name),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["custom-lists"] }),
    onError: (e) => { toast.error(String(e)); },
  });
}

export function useDeleteCustomList() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => q.deleteCustomList(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["custom-lists"] });
      qc.invalidateQueries({ queryKey: ["custom-list-items"] });
    },
    onError: (e) => { toast.error(String(e)); },
  });
}

export function useSetCustomListItems() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      listId,
      items,
    }: {
      listId: number;
      items: { value: string; color?: string }[];
    }) => q.setCustomListItems(listId, items),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ["custom-list-items", variables.listId] });
      qc.invalidateQueries({ queryKey: ["custom-lists"] });
    },
    onError: (e) => { toast.error(String(e)); },
  });
}

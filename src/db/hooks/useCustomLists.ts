import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import * as q from "../queries/customLists";
import { snapshotRows, pushRestore } from "../undoRestore";
import { getLabels } from "../../lib/notifyError";

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
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["custom-lists"] });
    qc.invalidateQueries({ queryKey: ["custom-list-items"] });
  };
  return useMutation({
    mutationFn: async (id: number) => {
      const snap = await snapshotRows([
        { table: "custom_lists", where: "id = $1", params: [id] },
        { table: "custom_list_items", where: "list_id = $1", params: [id] },
      ]);
      await q.deleteCustomList(id);
      const name = String(snap[0].rows[0]?.name ?? "");
      pushRestore(`${getLabels().undo_delete_list} "${name}"`, snap, { redo: () => q.deleteCustomList(id), invalidate });
    },
    onSuccess: invalidate,
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

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as q from "../queries/activities";

export function useActivities() {
  return useQuery({ queryKey: ["activities"], queryFn: q.getActivities });
}

export function useCreateActivity() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ name_fr, name_en }: { name_fr: string; name_en: string }) =>
      q.createActivity(name_fr, name_en),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["activities"] }),
  });
}

export function useUpdateActivity() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, name_fr, name_en }: { id: number; name_fr: string; name_en: string }) =>
      q.updateActivity(id, { name_fr, name_en }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["activities"] }),
  });
}

export function useDeleteActivity() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => q.deleteActivity(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["activities"] }),
  });
}

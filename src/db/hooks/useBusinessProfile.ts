import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import * as q from "../queries/business-profile";
import type { BusinessProfile } from "../../types/business-profile";

export function useBusinessProfile() {
  return useQuery({
    queryKey: ["business-profile"],
    queryFn: q.getBusinessProfile,
  });
}

export function useUpdateBusinessProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Partial<Omit<BusinessProfile, "id">>) =>
      q.updateBusinessProfile(data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["business-profile"] }),
  });
}

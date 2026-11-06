import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import * as q from "../queries/business-profile";
import type { BusinessProfile } from "../../types/business-profile";
import { qk } from "../queryKeys";

export function useBusinessProfile() {
  return useQuery({
    queryKey: qk.businessProfile.all,
    queryFn: q.getBusinessProfile,
  });
}

export function useUpdateBusinessProfile() {
  const qc = useQueryClient();
  return useMutation({
    meta: { errorLabel: "error_save_profile" },
    mutationFn: (data: Partial<Omit<BusinessProfile, "id">>) =>
      q.updateBusinessProfile(data),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.businessProfile.all }),
  });
}

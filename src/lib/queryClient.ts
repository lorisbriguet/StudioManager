import { QueryClient, MutationCache } from "@tanstack/react-query";
import { notifyError, getLabels } from "./notifyError";

export const queryClient = new QueryClient({
  // Backstop for mutations without their own onError: a failed write must
  // never be silent (audit round 4 — calendar drag/drop, inline field saves
  // and wiki auto-save all swallowed errors). Hook-level onError opts out.
  mutationCache: new MutationCache({
    onError: (error, _variables, _context, mutation) => {
      if (!mutation.options.onError) {
        notifyError(getLabels().operation_failed, error);
      }
    },
  }),
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 5 * 60 * 1000 },
  },
});

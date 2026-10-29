import { QueryClient, MutationCache } from "@tanstack/react-query";
import { notify, getLabels } from "./notify";
import type { UIKey } from "../i18n/ui";

declare module "@tanstack/react-query" {
  interface Register {
    mutationMeta: {
      /**
       * The ui.ts key of the label shown when this mutation fails, e.g.
       * "error_save_invoice" ("Couldn't save the invoice"). Resolved when it
       * fails, so a language switch applies.
       */
      errorLabel?: UIKey;
    };
  }
}

export const queryClient = new QueryClient({
  // Every failed write is reported HERE, once: the mutation's
  // `meta.errorLabel` ("Couldn't save the invoice", generic label otherwise),
  // raw error logged with a "Details" copy. Hooks and call sites don't toast
  // the failure again. A hook-level onError opts out (it reports itself).
  // notify.error only drops an identical failure (same label and cause)
  // while its toast is up, so two different failed saves both show.
  mutationCache: new MutationCache({
    onError: (error, _variables, _context, mutation) => {
      if (mutation.options.onError) return;
      const t = getLabels();
      const key = mutation.meta?.errorLabel;
      notify.error(key ? t[key] : t.operation_failed, error);
    },
  }),
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 5 * 60 * 1000 },
  },
});

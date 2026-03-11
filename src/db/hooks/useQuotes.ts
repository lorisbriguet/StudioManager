import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import * as q from "../queries/quotes";
import type { Quote, QuoteLineItem } from "../../types/quote";
import { useUndoStore } from "../../stores/undo-store";

export function useQuotes() {
  return useQuery({ queryKey: ["quotes"], queryFn: q.getQuotes });
}

export function useQuote(id: number) {
  return useQuery({
    queryKey: ["quotes", id],
    queryFn: () => q.getQuote(id),
    enabled: !!id,
  });
}

export function useCreateQuote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ data, lineItems }: {
      data: Omit<Quote, "id" | "created_at" | "updated_at">;
      lineItems: Omit<QuoteLineItem, "id" | "quote_id">[];
    }) => {
      const id = await q.createQuote(data);
      await q.setQuoteLineItems(id, lineItems);
      return id;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["quotes"] }),
  });
}

export function useUpdateQuote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      data,
      lineItems,
    }: {
      id: number;
      data: Partial<Omit<Quote, "id" | "created_at" | "updated_at">>;
      lineItems?: Omit<QuoteLineItem, "id" | "quote_id">[];
    }) => {
      const prev = await q.getQuote(id);
      await q.updateQuote(id, data);
      if (lineItems) {
        await q.setQuoteLineItems(id, lineItems);
      }
      if (prev) {
        const prevData: Record<string, unknown> = {};
        for (const key of Object.keys(data)) {
          prevData[key] = (prev as unknown as Record<string, unknown>)[key];
        }
        useUndoStore.getState().push({
          label: `Update quote "${prev.reference}"`,
          execute: async () => {
            await q.updateQuote(id, prevData as Partial<Omit<Quote, "id" | "created_at" | "updated_at">>);
            qc.invalidateQueries({ queryKey: ["quotes"] });
          },
        });
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["quotes"] }),
  });
}

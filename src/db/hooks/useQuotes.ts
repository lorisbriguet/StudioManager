import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
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

export function useQuoteLineItems(quoteId: number) {
  return useQuery({
    queryKey: ["quote-line-items", quoteId],
    queryFn: () => q.getQuoteLineItems(quoteId),
    enabled: !!quoteId,
  });
}

export function useCreateQuote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ data, lineItems }: {
      data: Omit<Quote, "id" | "created_at" | "updated_at">;
      lineItems: Omit<QuoteLineItem, "id" | "quote_id">[];
    }) => {
      const id = await q.createQuoteWithLineItems(data, lineItems);
      useUndoStore.getState().push({
        label: `Create quote "${data.reference}"`,
        execute: async () => {
          await q.deleteQuote(id);
          qc.invalidateQueries({ queryKey: ["quotes"] });
        },
        redo: async () => {
          await q.createQuoteWithLineItems(data, lineItems);
          qc.invalidateQueries({ queryKey: ["quotes"] });
        },
      });
      return id;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["quotes"] }),
    onError: (e) => { toast.error(String(e)); },
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
      const prevLineItems = lineItems ? await q.getQuoteLineItems(id) : undefined;
      await q.updateQuoteWithLineItems(id, data, lineItems);
      if (prev) {
        const prevData: Record<string, unknown> = {};
        for (const key of Object.keys(data)) {
          prevData[key] = (prev as unknown as Record<string, unknown>)[key];
        }
        const prevItems = prevLineItems?.map(({ id: _iid, quote_id, ...rest }) => rest);
        useUndoStore.getState().push({
          label: `Update quote "${prev.reference}"`,
          execute: async () => {
            await q.updateQuoteWithLineItems(
              id,
              prevData as Partial<Omit<Quote, "id" | "created_at" | "updated_at">>,
              prevItems
            );
            qc.invalidateQueries({ queryKey: ["quotes"] });
          },
          redo: async () => {
            await q.updateQuoteWithLineItems(id, data, lineItems);
            qc.invalidateQueries({ queryKey: ["quotes"] });
          },
        });
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["quotes"] }),
    onError: (e) => { toast.error(String(e)); },
  });
}

export function useDeleteQuote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      const prev = await q.getQuote(id);
      const prevItems = await q.getQuoteLineItems(id);
      await q.deleteQuote(id);
      if (prev) {
        const { id: _id, created_at, updated_at, ...data } = prev;
        const items = prevItems.map(({ id: _iid, quote_id, ...rest }) => rest);
        useUndoStore.getState().push({
          label: `Delete quote "${prev.reference}"`,
          execute: async () => {
            await q.createQuoteWithLineItems(
              data as Omit<Quote, "id" | "created_at" | "updated_at">,
              items
            );
            qc.invalidateQueries({ queryKey: ["quotes"] });
          },
          redo: async () => {
            const quotes = await q.getQuotes();
            const restored = quotes.find((qu) => qu.reference === prev.reference);
            if (restored) {
              await q.deleteQuote(restored.id);
              qc.invalidateQueries({ queryKey: ["quotes"] });
            }
          },
        });
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["quotes"] }),
    onError: (e) => { toast.error(String(e)); },
  });
}

import * as q from "../queries/quotes";
import type { Quote, QuoteLineItem } from "../../types/quote";
import { documentHooks } from "./documentHooks";

/** Quote line items are cached under the quote, so refreshing ["quotes"] covers them. */
export const quoteLineItemsKey = (id: number) => ["quotes", id, "lineItems"];

const hooks = documentHooks<Quote, QuoteLineItem>({
  key: "quotes",
  lineItemsKey: quoteLineItemsKey,
  dateField: "quote_date",
  lineItemForeignKey: "quote_id",
  labels: {
    saveError: "error_save_quote",
    deleteError: "error_delete_quote",
    undoCreate: "undo_create_quote",
    undoUpdate: "undo_update_quote",
    undoDelete: "undo_delete_quote",
  },
  queries: {
    list: q.getQuotes,
    get: q.getQuote,
    listByProject: q.getQuotesByProject,
    lineItems: q.getQuoteLineItems,
    create: q.createQuoteWithLineItems,
    updateWithLineItems: q.updateQuoteWithLineItems,
    delete: q.deleteQuote,
    nextReference: q.getNextQuoteReference,
  },
  // Quotes can be deleted at any status.
});

export const useQuotes = hooks.useList;
export const useQuote = hooks.useOne;
export const useQuotesByProject = hooks.useByProject;
export const useQuoteLineItems = hooks.useLineItems;
export const useCreateQuote = hooks.useCreate;
export const useUpdateQuote = hooks.useUpdate;
export const useDeleteQuote = hooks.useDelete;

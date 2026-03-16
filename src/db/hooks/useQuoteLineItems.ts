import { useQuery } from "@tanstack/react-query";
import { getQuoteLineItems } from "../queries/quotes";

export function useQuoteLineItems(quoteId: number) {
  return useQuery({
    queryKey: ["quotes", quoteId, "lineItems"],
    queryFn: () => getQuoteLineItems(quoteId),
    enabled: !!quoteId,
  });
}

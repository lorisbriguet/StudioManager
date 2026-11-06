import { describe, it, expect, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { qk, invalidateMoney, invalidateTasks, invalidateTimeTracking } from "../db/queryKeys";

// The dashboard widgets read their own queries. Each one must be refreshed by
// a write helper, or it shows old figures until its cache goes stale (5 min).

function refreshedBy(helper: (qc: QueryClient) => void) {
  const qc = new QueryClient();
  const spy = vi.spyOn(qc, "invalidateQueries");
  helper(qc);
  return spy.mock.calls.map((c) => JSON.stringify((c[0] as { queryKey: unknown }).queryKey));
}

describe("query keys", () => {
  it("refreshes every dashboard widget from a write helper", () => {
    const refreshed = new Set([
      ...refreshedBy(invalidateMoney),
      ...refreshedBy(invalidateTasks),
      ...refreshedBy(invalidateTimeTracking),
    ]);
    for (const [name, key] of Object.entries(qk.dashboard)) {
      expect(refreshed.has(JSON.stringify(key)), name).toBe(true);
    }
  });

  it("refreshes the money widgets after a money write", () => {
    expect(refreshedBy(invalidateMoney)).toEqual([
      JSON.stringify(["finance"]),
      JSON.stringify(["invoice-aging"]),
      JSON.stringify(["expense-categories-all"]),
    ]);
  });

  it("keeps the keys the app used before the factory", () => {
    expect(qk.invoices.lineItems(5)).toEqual(["invoice-line-items", 5]);
    expect(qk.quotes.lineItems(5)).toEqual(["quotes", 5, "lineItems"]);
    expect(qk.finance.kpis(2026)).toEqual(["finance", "dashboard", 2026]);
    expect(qk.dashboard.billableSummary).toEqual(["billable-summary"]);
  });
});

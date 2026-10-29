import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { Subscription } from "../types/upkeep";
import type { PendingRenewal } from "../db/queries/subscriptions";
import { uiLabels } from "../i18n/ui";

// vitest aliases every @tauri-apps module to one mock file, so one factory covers them all.
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(), open: vi.fn(), ask: async () => true }));

const decide = vi.fn();
let subs: Subscription[] = [];
let pending: PendingRenewal[] = [];
const { mut } = vi.hoisted(() => ({
  mut: () => ({ mutate: () => {}, mutateAsync: async () => 0, isPending: false }),
}));

vi.mock("../db/hooks/useUpkeep", () => {
  return {
    useSubscriptions: () => ({ data: subs }),
    usePendingRenewals: () => ({ data: pending }),
    useDecideRenewal: () => ({ mutate: decide, mutateAsync: async (a: unknown) => decide(a), isPending: false }),
    useCreateSubscription: mut,
    useUpdateSubscription: mut,
    useCancelSubscription: mut,
    useDeleteSubscription: mut,
  };
});
vi.mock("../db/hooks/useExpenses", () => ({
  useExpenseCategories: () => ({ data: [{ code: "FA", name_fr: "Frais" }] }),
  useDistinctSuppliers: () => ({ data: [] }),
  useDuplicateCheck: () => ({ mutate: () => {}, mutateAsync: async () => [], isPending: false }),
  useCreateExpense: mut,
}));

import { SubscriptionsTab } from "../components/upkeep/SubscriptionsTab";
import { format } from "date-fns";
import { useAppStore } from "../stores/app-store";

const t = uiLabels.EN;

function sub(over: Partial<Subscription> = {}): Subscription {
  return {
    id: 1, name: "Creative Cloud", plan: "All apps", vendor: "Adobe", url: null,
    renews_on: "2026-12-01", anchor_day: 1, period: "year", cost: 840, currency: "CHF",
    status: "active", in_calendar: 1, alert: "default", calendar_event_id: null,
    coming_notified_for: null, notes: null, created_at: "", updated_at: "", ...over,
  };
}

function renewal(over: Partial<PendingRenewal> = {}): PendingRenewal {
  return {
    id: 9, subscription_id: 1, renewed_on: "2026-10-01", amount: 840, currency: "CHF",
    decision: "pending", expense_id: null, name: "Creative Cloud", ...over,
  } as PendingRenewal;
}

function renderTab() {
  return render(<MemoryRouter><SubscriptionsTab /></MemoryRouter>);
}

describe("SubscriptionsTab", () => {
  // Load the lazily imported Expenses page once, so no test pays for it.
  beforeAll(async () => { await import("../pages/ExpensesPage"); }, 30000);

  beforeEach(() => {
    decide.mockReset();
    subs = [sub()];
    pending = [renewal()];
  });

  it("shows pending renewals with the amount question", () => {
    renderTab();
    expect(screen.getByText(/Creative Cloud renewed · add CHF 840\.00 to expenses\?/)).toBeInTheDocument();
  });

  it("Add opens the expense form prefilled with vendor, amount and date", async () => {
    renderTab();
    fireEvent.click(screen.getByRole("button", { name: t.upkeep_renewal_add }));
    expect(await screen.findByDisplayValue("Adobe")).toBeInTheDocument();
    expect(screen.getByDisplayValue("840")).toBeInTheDocument();
    // The date field shows the date in the app's format.
    expect(screen.getByDisplayValue(format(new Date(2026, 9, 1), useAppStore.getState().dateFormat))).toBeInTheDocument();
  });

  it("cancelling the expense form leaves the renewal pending", async () => {
    renderTab();
    fireEvent.click(screen.getByRole("button", { name: t.upkeep_renewal_add }));
    await screen.findByDisplayValue("Adobe");
    fireEvent.click(screen.getByRole("button", { name: t.cancel }));
    expect(decide).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: t.upkeep_renewal_add })).toBeInTheDocument();
  });

  it("Skip marks the renewal skipped", () => {
    renderTab();
    fireEvent.click(screen.getByRole("button", { name: t.upkeep_renewal_skip }));
    expect(decide).toHaveBeenCalledWith({ id: 9, decision: "skipped" });
  });

  it("shows one yearly total line per currency", () => {
    subs = [
      sub(),
      sub({ id: 2, name: "Figma", period: "month", cost: 10, currency: "EUR" }),
      sub({ id: 3, name: "Old", cost: 100, currency: "CHF", status: "cancelled" }),
    ];
    pending = [];
    renderTab();
    expect(screen.getByText("CHF 840.00 / year")).toBeInTheDocument();
    expect(screen.getByText("EUR 120.00 / year")).toBeInTheDocument();
  });
});

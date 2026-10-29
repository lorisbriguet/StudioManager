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
const { mut, createExpense, getExchangeRate } = vi.hoisted(() => ({
  mut: () => ({ mutate: () => {}, mutateAsync: async () => 0, isPending: false }),
  createExpense: vi.fn(async (_data: Record<string, unknown>) => 5),
  getExchangeRate: vi.fn(async (_c: string): Promise<number | null> => null),
}));
vi.mock("../lib/exchangeRate", async (orig) => ({
  ...(await orig<typeof import("../lib/exchangeRate")>()),
  getExchangeRate: (c: string) => getExchangeRate(c),
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
  useCreateExpense: () => ({ mutate: () => {}, mutateAsync: createExpense, isPending: false }),
}));

import { SubscriptionsTab } from "../components/upkeep/SubscriptionsTab";
import { format } from "date-fns";
import { useAppStore } from "../stores/app-store";
import { notify } from "../lib/notify";

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
    createExpense.mockClear();
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

  it("a USD renewal is prefilled in CHF at today's rate, with the source amount kept in the notes", async () => {
    // 1 CHF = 1.25 USD.
    getExchangeRate.mockResolvedValueOnce(1.25);
    const info = vi.spyOn(notify, "info").mockImplementation(() => {});
    pending = [renewal({ amount: 15, currency: "USD", name: "Figma" })];
    subs = [sub({ vendor: "Figma Inc", currency: "USD", cost: 15 })];
    renderTab();
    fireEvent.click(screen.getByRole("button", { name: t.upkeep_renewal_add }));
    expect(await screen.findByDisplayValue("12")).toBeInTheDocument();
    expect(info).toHaveBeenCalledWith("USD 15.00 prefilled as CHF 12.00 (1 CHF = 1.2500 USD).");
    fireEvent.click(screen.getByRole("button", { name: t.save }));
    await vi.waitFor(() => expect(createExpense).toHaveBeenCalled());
    const saved = createExpense.mock.calls[0][0];
    expect(saved.amount).toBe(12);
    expect(saved.notes).toMatch(/^Converted from USD 15\.00 at 1 CHF = 1\.2500 USD/);
    info.mockRestore();
  });

  it("without an exchange rate it refuses instead of booking USD 15 as CHF 15", async () => {
    getExchangeRate.mockResolvedValueOnce(null);
    const error = vi.spyOn(notify, "error").mockImplementation(() => {});
    pending = [renewal({ amount: 15, currency: "USD", name: "Figma" })];
    renderTab();
    fireEvent.click(screen.getByRole("button", { name: t.upkeep_renewal_add }));
    await vi.waitFor(() => expect(error).toHaveBeenCalledWith(t.upkeep_expense_no_rate.replace("{currency}", "USD")));
    expect(screen.queryByDisplayValue("15")).toBeNull();
    expect(createExpense).not.toHaveBeenCalled();
    expect(decide).not.toHaveBeenCalled();
    // The question stays.
    expect(screen.getByRole("button", { name: t.upkeep_renewal_add })).toBeInTheDocument();
    error.mockRestore();
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

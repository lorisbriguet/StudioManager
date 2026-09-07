import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useRecurringCheck, runRecurringCheck } from "../hooks/useRecurringCheck";
import { useAppStore } from "../stores/app-store";
import { getDueTemplates, updateRecurringTemplate } from "../db/queries/recurring";
import { getInvoice, getInvoiceLineItems, createInvoiceWithLineItems } from "../db/queries/invoices";
import { todayLocalISO } from "../utils/localDate";
import { toast } from "sonner";

// Controllable clock: the focus re-check compares "today" against the last
// run day, so tests must be able to move the calendar forward.
vi.mock("../utils/localDate", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../utils/localDate")>();
  return { ...actual, todayLocalISO: vi.fn(actual.todayLocalISO) };
});
const actualLocalDate = await vi.importActual<typeof import("../utils/localDate")>("../utils/localDate");

vi.mock("../db/queries/recurring", () => ({
  getDueTemplates: vi.fn(),
  updateRecurringTemplate: vi.fn(),
}));
vi.mock("../db/queries/invoices", () => ({
  getInvoice: vi.fn(),
  getInvoiceLineItems: vi.fn(),
  createInvoiceWithLineItems: vi.fn(),
}));
vi.mock("../db/queries/notifications", () => ({ createNotification: vi.fn() }));
vi.mock("../lib/nativeNotification", () => ({ sendNativeNotification: vi.fn() }));
// plugin-log needs the real Tauri bridge — unmocked it surfaces unhandled
// rejections ("Cannot read properties of undefined (reading 'invoke')").
vi.mock("../lib/log", () => ({
  logError: vi.fn(),
  logWarn: vi.fn(),
  logInfo: vi.fn(),
  logDebug: vi.fn(),
}));
vi.mock("sonner", () => ({
  toast: {
    info: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
    loading: vi.fn(),
    dismiss: vi.fn(),
  },
}));

const baseInvoice = {
  id: 5,
  reference: "2026-0005",
  client_id: "c1",
  project_id: null,
  status: "sent",
  language: "FR",
  activity: "",
  activity_id: null,
  assignment: "",
  invoice_date: "2026-01-15",
  due_date: "2026-02-14",
  payment_terms_days: 30,
  subtotal: 100,
  discount_applied: 0,
  discount_rate: 0,
  discount_label: "",
  total: 100,
  paid_date: null,
  contact_id: null,
  billing_address_id: null,
  currency: "CHF",
  exchange_rate: null,
  chf_equivalent: 100,
  po_number: null,
  pdf_path: null,
  from_quote_id: null,
  notes: "",
  reminder_count: 0,
  last_reminder_date: null,
  template_id: null,
};

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

function isoMonthsAgo(months: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() - months);
  return d.toISOString().slice(0, 10);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(todayLocalISO).mockImplementation(actualLocalDate.todayLocalISO);
  useAppStore.setState({ language: "EN" });
  vi.mocked(getInvoice).mockResolvedValue(baseInvoice as never);
  vi.mocked(getInvoiceLineItems).mockResolvedValue([]);
  vi.mocked(createInvoiceWithLineItems).mockResolvedValue(1 as never);
  vi.mocked(updateRecurringTemplate).mockResolvedValue(undefined as never);
});

describe("useRecurringCheck", () => {
  it("generates one draft per overdue period and persists next_due each step", async () => {
    vi.mocked(getDueTemplates).mockResolvedValue([
      { id: 1, base_invoice_id: 5, client_id: "c1", frequency: "monthly", next_due: isoMonthsAgo(3), active: 1 },
    ] as never);

    renderHook(() => useRecurringCheck(), { wrapper });

    await waitFor(() => {
      expect(toast.info).toHaveBeenCalled();
    });
    // ~3-4 periods depending on day-of-month; every draft persisted its advance
    const drafts = vi.mocked(createInvoiceWithLineItems).mock.calls.length;
    expect(drafts).toBeGreaterThanOrEqual(3);
    expect(vi.mocked(updateRecurringTemplate).mock.calls.length).toBe(drafts);
    // Drafts stay drafts with unique DRAFT references
    for (const call of vi.mocked(createInvoiceWithLineItems).mock.calls) {
      expect((call[0] as { status: string }).status).toBe("draft");
      expect((call[0] as { reference: string }).reference).toMatch(/^DRAFT-/);
    }
  });

  it("surfaces a warning when the catch-up cap is hit", async () => {
    vi.mocked(getDueTemplates).mockResolvedValue([
      { id: 1, base_invoice_id: 5, client_id: "c1", frequency: "monthly", next_due: "2000-01-15", active: 1 },
    ] as never);

    renderHook(() => useRecurringCheck(), { wrapper });

    await waitFor(() => {
      expect(toast.warning).toHaveBeenCalled();
    });
    expect(vi.mocked(createInvoiceWithLineItems).mock.calls.length).toBe(60);
  });

  it("runRecurringCheck returns the number of drafts generated", async () => {
    const today = new Date().toISOString().slice(0, 10);
    vi.mocked(getDueTemplates).mockResolvedValue([
      { id: 1, base_invoice_id: 5, client_id: "c1", frequency: "monthly", next_due: today, active: 1 },
    ] as never);

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const generated = await runRecurringCheck(qc);

    expect(generated).toBe(1);
    expect(vi.mocked(createInvoiceWithLineItems).mock.calls.length).toBe(1);
  });

  it("runRecurringCheck returns 0 when nothing is due", async () => {
    vi.mocked(getDueTemplates).mockResolvedValue([] as never);

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const generated = await runRecurringCheck(qc);

    expect(generated).toBe(0);
    expect(createInvoiceWithLineItems).not.toHaveBeenCalled();
  });

  it("runRecurringCheck ignores a second call while one is in flight", async () => {
    const today = new Date().toISOString().slice(0, 10);
    vi.mocked(getDueTemplates).mockResolvedValue([
      { id: 1, base_invoice_id: 5, client_id: "c1", frequency: "monthly", next_due: today, active: 1 },
    ] as never);
    let release!: (v: number) => void;
    vi.mocked(createInvoiceWithLineItems).mockImplementation(
      () => new Promise((resolve) => { release = resolve as (v: number) => void; }) as never
    );

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const first = runRecurringCheck(qc);
    // Let the first run reach the hanging createInvoiceWithLineItems call
    await waitFor(() => expect(createInvoiceWithLineItems).toHaveBeenCalled());
    const second = await runRecurringCheck(qc);

    expect(second).toBe(0);
    expect(vi.mocked(createInvoiceWithLineItems).mock.calls.length).toBe(1);

    release(1);
    expect(await first).toBe(1);
    expect(vi.mocked(createInvoiceWithLineItems).mock.calls.length).toBe(1);
  });

  it("skips a template with a corrupt next_due and surfaces an error", async () => {
    vi.mocked(getDueTemplates).mockResolvedValue([
      { id: 1, base_invoice_id: 5, client_id: "c1", frequency: "monthly", next_due: "garbage", active: 1 },
    ] as never);

    renderHook(() => useRecurringCheck(), { wrapper });

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalled();
    });
    expect(createInvoiceWithLineItems).not.toHaveBeenCalled();
  });

  it("re-runs the check on window focus when the day has changed", async () => {
    vi.mocked(getDueTemplates).mockResolvedValue([] as never);

    renderHook(() => useRecurringCheck(), { wrapper });
    await waitFor(() => expect(getDueTemplates).toHaveBeenCalledTimes(1));

    vi.mocked(todayLocalISO).mockReturnValue("2099-01-01");
    window.dispatchEvent(new Event("focus"));

    await waitFor(() => expect(getDueTemplates).toHaveBeenCalledTimes(2));
  });

  it("does not re-run on window focus on the same day", async () => {
    vi.mocked(getDueTemplates).mockResolvedValue([] as never);

    renderHook(() => useRecurringCheck(), { wrapper });
    await waitFor(() => expect(getDueTemplates).toHaveBeenCalledTimes(1));

    window.dispatchEvent(new Event("focus"));
    await new Promise((r) => setTimeout(r, 20));

    expect(getDueTemplates).toHaveBeenCalledTimes(1);
  });
});

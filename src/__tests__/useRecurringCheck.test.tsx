import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useRecurringCheck } from "../hooks/useRecurringCheck";
import { useAppStore } from "../stores/app-store";
import { getDueTemplates, updateRecurringTemplate } from "../db/queries/recurring";
import { getInvoice, getInvoiceLineItems, createInvoiceWithLineItems } from "../db/queries/invoices";
import { toast } from "sonner";

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
});

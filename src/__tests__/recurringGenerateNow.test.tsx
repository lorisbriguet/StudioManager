import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { InvoicesPage } from "../pages/InvoicesPage";
import { useAppStore } from "../stores/app-store";
import { getDb } from "../db";
import { setSelectHandler } from "../__mocks__/tauri-sql";
import { runRecurringCheck } from "../hooks/useRecurringCheck";
import { toast } from "sonner";

vi.mock("../hooks/useRecurringCheck", () => ({
  useRecurringCheck: vi.fn(),
  runRecurringCheck: vi.fn(),
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

// "Generate now" in the recurring panel runs the same check as startup /
// focus; when nothing is due the click must still give feedback.

const YEAR = new Date().getFullYear();

const invoiceRow = {
  id: 5,
  reference: "2026-0005",
  client_id: "c1",
  project_id: null,
  contact_id: null,
  billing_address_id: null,
  template_id: null,
  status: "paid",
  invoice_date: `${YEAR}-02-01`,
  due_date: `${YEAR}-03-01`,
  paid_date: `${YEAR}-03-01`,
  total: 500,
  currency: "CHF",
  chf_equivalent: 500,
  reminder_count: 0,
  pdf_path: null,
};

const templateRow = {
  id: 1,
  base_invoice_id: 5,
  client_id: "c1",
  frequency: "monthly",
  next_due: `${YEAR}-09-04`,
  active: 1,
};

async function renderRecurringPanel() {
  setSelectHandler((sql) => {
    const flat = sql.replace(/\s+/g, " ");
    if (flat.includes("FROM recurring_invoice_templates")) return [templateRow];
    if (flat.includes("FROM invoices")) return [invoiceRow];
    if (flat.includes("FROM clients")) return [{ id: "c1", name: "ACME" }];
    return [];
  });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <InvoicesPage />
      </MemoryRouter>
    </QueryClientProvider>
  );
  // Open the recurring panel via the header toggle
  fireEvent.click(await screen.findByRole("button", { name: /^recurring/i }));
  await screen.findByText("Recurring Invoices");
}

beforeEach(async () => {
  await getDb();
  useAppStore.setState({ language: "EN" });
  vi.clearAllMocks();
});

afterEach(() => {
  setSelectHandler(null);
  cleanup();
});

describe("recurring generate now button", () => {
  it("runs the recurring check and reports when nothing is due", async () => {
    vi.mocked(runRecurringCheck).mockResolvedValue(0);
    await renderRecurringPanel();

    fireEvent.click(screen.getByRole("button", { name: /generate now/i }));

    await waitFor(() => expect(runRecurringCheck).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(toast.info).toHaveBeenCalledWith("No recurring invoices due")
    );
  });

  it("stays silent when drafts were generated (the check itself toasts)", async () => {
    vi.mocked(runRecurringCheck).mockResolvedValue(2);
    await renderRecurringPanel();

    fireEvent.click(screen.getByRole("button", { name: /generate now/i }));

    await waitFor(() => expect(runRecurringCheck).toHaveBeenCalledTimes(1));
    expect(toast.info).not.toHaveBeenCalled();
  });
});
